// src/react-bridge-client.ts
// MCP Agent V2: WebSocket client + React internals integration with commit envelopes, channels, selectors, and deref RPC

import { type FiberNode } from './internals';

type ChannelName =
  | 'commit'
  | 'render'
  | 'findings'
  | 'metrics'
  | 'control'
  | 'snapshot';
type Budget = { kbPerSec: number; msgPerSec: number };

type CommitChange = {
  fid: string;
  type: 'mount' | 'update' | 'unmount';
  displayName: string;
  ownerFid?: string;
  key?: string;
  path?: string;
  why: string[];
  costMs?: number;
  propDiff?: { changed: string[]; preview?: Record<string, any> };
  stateDiff?: { changed: string[]; preview?: Record<string, any> };
  contextDiff?: { changed: string[] };
  source?: { file: string; line: number; col: number };
};

type CommitEnvelope = {
  sessionId: string;
  commitId: number;
  ts: number;
  commitMs?: number;
  changes: CommitChange[];
  findings?: any[];
};

// Runtime logging gate: default OFF. Set window.REACT_DEBUGGER_VERBOSE = true to enable.
function isLoggingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!w.REACT_DEBUGGER_VERBOSE || !!w.REACT_DEBUGGER_LOGS;
}

function LOG(...args: any[]) {
  if (isLoggingEnabled()) console.log('[react-debugger]', ...args);
}

function LOG_WARN(...args: any[]) {
  if (isLoggingEnabled()) console.warn('[react-debugger]', ...args);
}

function LOG_ERROR(...args: any[]) {
  if (isLoggingEnabled()) console.error('[react-debugger]', ...args);
}

type Selector = {
  displayName?: string | { $regex: string };
  file?: string | { $regex: string };
  pathContains?: string; // 'List>Row'
  keyEquals?: string;
  costMsGte?: number;
  propsMatch?: Record<string, any>;
};

type Subscription = {
  id: string;
  channels: ChannelName[];
  selector?: Selector;
  fields?: { props?: string[]; state?: string[]; context?: string[] };
  priority?: 'low' | 'normal' | 'high';
  budgets?: { bandwidthKBs?: number; msgPerSec?: number };
};

interface MCPAgentMessage {
  type:
    | 'SUBSCRIBE'
    | 'UNSUBSCRIBE'
    | 'GET_PROPS'
    | 'GET_HOOKS_STATE'
    | 'RESYNC';
  id?: string; // componentId or subscriptionId
  keys?: string[];
  requestId?: string;
  data?: any;
  success?: boolean;
  timestamp?: number;
  channels?: ChannelName[];
  selector?: Selector;
  fields?: { props?: string[]; state?: string[]; context?: string[] };
  budgets?: { bandwidthKBs?: number; msgPerSec?: number };
  fid?: string;
  commitId?: number;
  paths?: string[];
}

class MCPDebuggerAgent {
  private instanceId = `agent_${Math.random().toString(36).slice(2, 8)}`;
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private isConnected: boolean = false;
  private messageBuffer: any[] = [];
  private reconnectAttempt = 0;
  private readonly maxBuffered = 200;
  private trackedComponents: Map<
    string,
    {
      fiber: FiberNode;
      lastData: any;
    }
  > = new Map();

  private subscriptions = new Map<string, Subscription>();

  private commitId = 0;
  private lastSnapshot = new Map<
    string,
    {
      props?: any;
      state?: any;
      context?: any;
      displayName?: string;
      ownerFid?: string;
    }
  >();
  private renderCountMap = new WeakMap<FiberNode, number>();
  private ownerPathCache = new WeakMap<FiberNode, string>();

  private ringBuffer: {
    commitId: number;
    perFiber: Map<
      string,
      {
        props?: any;
        hooks?: any;
        context?: any;
        displayName?: string;
        ownerFid?: string;
      }
    >;
  }[] = [];
  private readonly ringSize = 300;
  private roots: FiberNode[] = [];

  private channels!: ChannelManager;
  private sessionId: string = `sess_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  // Findings heuristics state
  private propChangeStreak = new Map<
    string,
    { count: number; lastCommit: number }
  >();
  private updateTimestamps = new Map<string, number[]>();

  public getInstanceId(): string {
    return this.instanceId;
  }

  constructor(serverUrl = 'ws://localhost:5679') {
    this.serverUrl = serverUrl;
    this.ensureFiberDataBridge();
    this.connect();
  }

  private ensureFiberDataBridge() {
    // Create FiberDataBridge if it doesn't exist
    if (typeof window !== 'undefined' && !(window as any).FiberDataBridge) {
      (window as any).FiberDataBridge = {
        // Set the current root fiber for data extraction
        setCurrentRootFiber: (rootFiber: FiberNode) => {
          (window as any).FiberDataBridge.currentRootFiber = rootFiber;
        },

        // Current root fiber for traversal
        currentRootFiber: null as FiberNode | null,
      };
    }

    // Set up React DevTools hook to capture root fiber
    this.setupReactDevToolsHook();
  }

  private setupReactDevToolsHook() {
    if (typeof window === 'undefined') return;

    const attach = (hook: any) => {
      const original = hook.onCommitFiberRoot?.bind(hook);
      hook.onCommitFiberRoot = (id: any, root: any, ...rest: any[]) => {
        this.onCommitFiberRootPatch(id, root);
        return original?.(id, root, ...rest);
      };
    };

    const tryAttach = () => {
      const h = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (h && typeof h.onCommitFiberRoot === 'function') {
        attach(h);
        return true;
      }
      return false;
    };

    if (tryAttach()) return;

    // Wait for DevTools/renderer inject; retry a few times
    let tries = 0;
    const t = setInterval(() => {
      if (tryAttach()) {
        clearInterval(t);
      } else if (++tries > 60) {
        clearInterval(t);
      }
    }, 250);
  }

  private onCommitFiberRootPatch(_id: any, root: any) {
    try {
      // Update current root fiber for deref
      const bridge = (window as any).FiberDataBridge;
      if (bridge) bridge.setCurrentRootFiber(root.current);

      // Reset per-commit caches that can go stale across remounts
      this.ownerPathCache = new WeakMap();

      const start = performance.now();
      const changes: CommitChange[] = [];

      // Track unique roots for multi-root apps
      const curRoot = root?.current as FiberNode | null;
      if (curRoot) {
        if (!this.roots.includes(curRoot)) this.roots.push(curRoot);
      }

      // Build changes by traversing tree
      const prevFids = new Set<string>(this.lastSnapshot.keys());
      const seenFids = new Set<string>();
      let fiberCount = 0;
      let changesFound = 0;

      this.forEachFiberInTree(root.current, (fiber) => {
        fiberCount++;
        const fid = this.fidFor(fiber);
        seenFids.add(fid);
        const prev = this.lastSnapshot.get(fid) || {};

        const nowProps = this.safePreview(fiber.memoizedProps);
        const nowHooks = this.previewHooksState(fiber.memoizedState);
        const nowStatePreview = Object.keys(nowHooks).length
          ? nowHooks
          : undefined;
        const nowCtx = this.previewContext(fiber);

        const propDiff = this.diffObject(prev.props, nowProps);
        const stateDiff = this.diffObject(prev.state, nowStatePreview);
        const contextDiff = this.diffObject(prev.context, nowCtx);
        const ownerFidNow = fiber.return
          ? this.fidFor(fiber.return)
          : undefined;
        const pathNow = this.ownerPath(fiber);
        const why = this.whyReasons(
          propDiff,
          stateDiff,
          contextDiff,
          fiber,
          (prev as any).ownerFid,
          ownerFidNow
        );

        if (why.length) {
          changesFound++;
          const ownerFid = ownerFidNow;
          const type: 'mount' | 'update' = prev.props ? 'update' : 'mount';
          changes.push({
            fid,
            type,
            displayName: this.displayNameOf(fiber),
            ownerFid,
            key: (fiber as any).key ?? undefined,
            path: pathNow,
            why,
            propDiff,
            stateDiff,
            contextDiff,
            source: this.sourceOf(fiber) || undefined,
          });
          // render count bump on update
          if (type === 'update') this.bumpRenderCount(fiber);
        }

        this.lastSnapshot.set(fid, {
          props: nowProps,
          state: nowStatePreview,
          context: nowCtx,
          displayName: this.displayNameOf(fiber),
          ownerFid: ownerFidNow,
        });
      });

      // Detect unmounts
      let unmountCount = 0;
      for (const fid of prevFids) {
        if (!seenFids.has(fid)) {
          unmountCount++;
          const prev = this.lastSnapshot.get(fid) || {};
          changes.push({
            fid,
            type: 'unmount',
            displayName: (prev as any).displayName || 'Unknown',
            ownerFid: (prev as any).ownerFid,
            key: undefined,
            why: ['unmount'],
          });
          this.lastSnapshot.delete(fid);
        }
      }

      const env: CommitEnvelope = {
        sessionId: this.sessionId,
        commitId: ++this.commitId,
        ts: Date.now(),
        commitMs: performance.now() - start,
        changes,
      };

      // Update ring buffer snapshots for deref
      const perFiber = new Map<
        string,
        {
          props?: any;
          state?: any;
          hooks?: any;
          context?: any;
          displayName?: string;
          ownerFid?: string;
        }
      >();
      for (const [fid, snap] of this.lastSnapshot.entries()) {
        perFiber.set(fid, {
          props: (snap as any).props,
          state: (snap as any).state,
          hooks: (snap as any).state,
          context: (snap as any).context,
          displayName: (snap as any).displayName,
          ownerFid: (snap as any).ownerFid,
        });
      }

      this.ringBuffer.push({ commitId: this.commitId, perFiber });
      if (this.ringBuffer.length > this.ringSize) this.ringBuffer.shift();

      if (this.channels) {
        const subs = Array.from(this.subscriptions.values());

        if (subs.length === 0) {
          // no-op until a SUBSCRIBE arrives
        } else {
          for (const sub of subs) {
            if (!sub.channels.includes('commit')) {
              continue;
            }

            const filtered = this.filterChangesBySelector(
              env.changes,
              sub.selector
            );

            if (filtered.length) {
              try {
                this.channels.send('commit', {
                  payload: { ...env, changes: filtered },
                  subscriptionId: sub.id,
                });
              } catch (error) {}

              if (sub.channels.includes('findings')) {
                const findings = this.buildFindings(filtered, env.commitId);

                if (findings.length) {
                  try {
                    this.channels.send('findings', {
                      payload: {
                        sessionId: this.sessionId,
                        commitId: env.commitId,
                        ts: env.ts,
                        findings,
                      },
                      subscriptionId: sub.id,
                    });
                  } catch (error) {}
                }
              }
            } else {
            }
          }
        }
      } else {
        LOG_WARN(
          `[onCommitFiberRootPatch] id=${this.instanceId} ⚠️ No channels manager available - cannot send data`
        );
      }

      LOG(
        `[onCommitFiberRootPatch] id=${this.instanceId} Completed commit ${
          env.commitId
        } in ${env.commitMs?.toFixed(2)}ms`
      );
    } catch (e) {
      LOG_ERROR(
        `[onCommitFiberRootPatch] id=${this.instanceId} fatal error inside commit handler:`,
        e
      );
    } finally {
      LOG(
        `[onCommitFiberRootPatch] id=${this.instanceId} end (may still proceed to channel sends)`
      );
    }
  }

  private connect() {
    const doConnect = () => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempt = 0;
          // init channels manager
          this.channels = new ChannelManager(this.ws!, {
            commit: { kbPerSec: 150, msgPerSec: 10 },
            render: { kbPerSec: 60, msgPerSec: 40 },
            findings: { kbPerSec: 25, msgPerSec: 20 },
            metrics: { kbPerSec: 10, msgPerSec: 2 },
            control: { kbPerSec: 15, msgPerSec: 20 },
            snapshot: { kbPerSec: 150, msgPerSec: 10 },
          });

          while (this.messageBuffer.length && this.isConnected) {
            const msg = this.messageBuffer.shift();
            try {
              this.ws!.send(JSON.stringify(msg));
            } catch (error) {
              LOG_ERROR('[MCPAgent] Failed to send buffered message:', error);
            }
          }
        };

        this.ws.onmessage = (event) => {
          try {
            const message: MCPAgentMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            LOG_ERROR('[MCP Agent] Failed to parse message:', error);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.channels = null as any; // Clear channels manager
          const base = Math.min(
            30000,
            1000 * Math.pow(2, this.reconnectAttempt++)
          );
          const jitter = Math.random() * 250;
          const reconnectDelay = base + jitter;

          setTimeout(doConnect, reconnectDelay);
        };

        this.ws.onerror = (error) => {
          LOG_ERROR('[MCP Agent] WebSocket error:', error);
        };
      } catch (error) {
        const base = Math.min(
          30000,
          1000 * Math.pow(2, this.reconnectAttempt++)
        );
        const jitter = Math.random() * 250;
        setTimeout(doConnect, base + jitter);
      }
    };

    doConnect();
  }

  private handleMessage(message: MCPAgentMessage) {
    switch (message.type) {
      case 'SUBSCRIBE': {
        const sub: Subscription = {
          id: message.id!,
          channels: message.channels || ['commit', 'findings'],
          selector: message.selector,
          fields: message.fields,
          priority: 'high',
          budgets: message.budgets,
        };
        this.subscriptions.set(sub.id, sub);
        // send initial snapshot
        const snapshotPayload = this.buildSnapshot(
          sub.id,
          sub.selector,
          sub.fields
        );
        this.channels?.send('snapshot', { ...snapshotPayload });

        // seed ring buffer from live tree if empty
        if (this.ringBuffer.length === 0) {
          this.seedCachesFromLiveTree();
        }

        // also emit a control status so the server can fail fast if selector matched nothing
        const matchCount = (snapshotPayload as any)?.payload?.rows?.length ?? 0;
        this.channels?.send('control', {
          type: matchCount > 0 ? 'SUBSCRIBE_OK' : 'SUBSCRIBE_EMPTY',
          subscriptionId: sub.id,
          selector: sub.selector,
          matchCount,
        });
        break;
      }
      case 'UNSUBSCRIBE':
        if (message.id) this.subscriptions.delete(message.id);
        break;
      case 'GET_PROPS':
        this.handleDerefRequest('props', message);
        break;
      case 'GET_HOOKS_STATE':
        this.handleDerefRequest('hooks', message);
        break;
      case 'RESYNC': {
        this.seedCachesFromLiveTree();
        const sub = message.id ? this.subscriptions.get(message.id) : undefined;
        if (sub) {
          const snap = this.buildSnapshot(sub.id, sub.selector, sub.fields);
          this.channels?.send('snapshot', { ...snap });
        } else {
          // Global resync: send a control not-ready then best-effort snapshot for all
          for (const s of this.subscriptions.values()) {
            const snap = this.buildSnapshot(s.id, s.selector, s.fields);
            this.channels?.send('snapshot', { ...snap });
          }
        }
        break;
      }
    }
  }

  private safePreview(value: any, depth: number = 0): any {
    const maxDepth = 3;
    const maxArray = 3;
    const maxString = 200;
    if (depth > maxDepth) return '[…]';
    if (value == null) return value;
    const t = typeof value;
    if (t === 'string')
      return value.length > maxString ? value.slice(0, maxString) + '…' : value;
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'function') return '[Function]';
    if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement)
      return '[HTMLElement]';
    if (Array.isArray(value)) {
      const len = value.length;
      const items = value
        .slice(0, maxArray)
        .map((v) => this.safePreview(v, depth + 1));
      return len > maxArray ? [...items, `…(${len - maxArray} more)`] : items;
    }
    if (t === 'object') {
      // Redaction support via window.REACT_DEBUGGER_REDACT
      // Only enumerate truly plain objects. Exotic objects (Proxies,
      // Next.js dynamic API wrappers, DOM wrappers, etc.) may throw or
      // emit runtime warnings when inspected; summarize them instead of
      // iterating their keys.
      if (!this.isPlainObject(value)) {
        try {
          const name =
            value && value.constructor ? value.constructor.name : 'Object';
          return `[${name}]`;
        } catch (e) {
          return '[Object]';
        }
      }
      const result: any = {};
      let count = 0;
      for (const k of Object.keys(value)) {
        if (count++ >= 10) {
          result['…'] = 'more';
          break;
        }
        const v = (value as any)[k];
        if (typeof v === 'function') continue;
        result[k] = this.safePreview(v, depth + 1);
      }
      return result;
    }
    return String(value);
  }

  private bumpRenderCount(fiber: FiberNode) {
    const n = this.renderCountMap.get(fiber) || 0;
    this.renderCountMap.set(fiber, n + 1);
  }

  private extractContext(fiber: FiberNode): Record<string, any> {
    const context: Record<string, any> = {};
    let currentFiber: FiberNode | null = fiber;

    while (currentFiber) {
      if (currentFiber.type && typeof currentFiber.type === 'object') {
        const type = currentFiber.type as any;
        if (type.$$typeof === Symbol.for('react.context')) {
          const contextName = type._context?.displayName || 'Context';
          context[contextName] = this.safePreview(
            currentFiber.memoizedProps?.value,
            0
          );
        }
      }
      currentFiber = currentFiber.return;
    }

    return context;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.trackedComponents.clear();
  }

  private forEachFiberInTree(
    root: FiberNode | null,
    visit: (fiber: FiberNode) => void
  ) {
    const stack: (FiberNode | null)[] = [root];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      visit(f);
      if ((f as any).child) stack.push((f as any).child);
      if ((f as any).sibling) stack.push((f as any).sibling);
    }
  }

  private previewHooksState(hookNode: any): Record<string, any> {
    const result: Record<string, any> = {};
    let i = 0,
      h = hookNode;
    while (h && i < 20) {
      if (h.queue && 'lastRenderedState' in h.queue) {
        result[`state#${i}`] = this.safePreview(h.queue.lastRenderedState);
      }
      if (
        h.memoizedState &&
        typeof h.memoizedState === 'object' &&
        'current' in h.memoizedState
      ) {
        result[`ref#${i}`] = this.safePreview(h.memoizedState.current);
      }
      h = h.next;
      i++;
    }
    return result;
  }

  private previewContext(fiber: FiberNode): Record<string, any> {
    // lightweight context preview (same as extractContext but previewed)
    return this.extractContext(fiber);
  }

  private isPlainObject(v: any): v is Record<string, any> {
    // Consider only null-prototype or Object.prototype objects as plain.
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }

  private diffObject(
    prev?: any,
    next?: any
  ):
    | {
        changed: string[];
        preview?: Record<string, any>;
        added?: string[];
        removed?: string[];
      }
    | undefined {
    // identical or both nullish
    if (prev === next || (!prev && !next)) return undefined;

    const prevIsObj = this.isPlainObject(prev);
    const nextIsObj = this.isPlainObject(next);

    // If either side is NOT a plain object, treat as a scalar change at the root
    if (!prevIsObj || !nextIsObj) {
      return {
        changed: ['<root>'],
        preview: { '<root>': this.safePreview(next) },
      };
    }

    // Both objects: do a shallow key diff without `in` on primitives
    const keysP = Object.keys(prev);
    const keysN = Object.keys(next);
    const setP = new Set(keysP);
    const setN = new Set(keysN);
    const all = new Set([...keysP, ...keysN]);

    const changed: string[] = [];
    const preview: Record<string, any> = {};
    for (const k of all) {
      if ((prev as any)[k] !== (next as any)[k]) {
        changed.push(k);
        preview[k] = this.safePreview((next as any)[k]);
      }
    }

    const added = [...setN].filter((k) => !setP.has(k));
    const removed = [...setP].filter((k) => !setN.has(k));

    if (!changed.length && !added.length && !removed.length) return undefined;
    return {
      changed,
      preview,
      added: added.length ? added : undefined,
      removed: removed.length ? removed : undefined,
    };
  }

  private whyReasons(
    propDiff: { changed?: string[] } | undefined,
    hooksDiff: { changed?: string[] } | undefined,
    contextDiff: { changed?: string[] } | undefined,
    _fiber: FiberNode,
    prevOwnerFid?: string,
    ownerFidNow?: string
  ): string[] {
    const reasons: string[] = [];
    if (propDiff && propDiff.changed && propDiff.changed.length) {
      for (const k of propDiff.changed.slice(0, 5))
        reasons.push(`prop(name=${k})`);
    }
    if (hooksDiff && hooksDiff.changed && hooksDiff.changed.length)
      reasons.push('hooks');
    if (contextDiff && contextDiff.changed && contextDiff.changed.length)
      reasons.push('context');
    if (
      prevOwnerFid !== undefined &&
      ownerFidNow !== undefined &&
      prevOwnerFid !== ownerFidNow
    )
      reasons.push('ownerChanged');
    return reasons;
  }

  private fidFor(fiber: FiberNode): string {
    const path = this.ownerPath(fiber);
    const key = (fiber as any).key ?? '';
    const src = this.sourceOf(fiber);
    const sig = `${path}|k:${key}|${src?.file ?? ''}:${src?.line ?? ''}:${
      src?.col ?? ''
    }`;

    return this.hash(sig);
  }

  private displayNameOf(fiber: FiberNode): string {
    if ((fiber as any).type) {
      const t: any = (fiber as any).type;
      if (typeof t === 'function')
        return t.displayName || t.name || 'Anonymous';
      if (typeof t === 'string') return t;
    }
    return 'Unknown';
  }

  private ownerPath(f: FiberNode): string {
    const cached = this.ownerPathCache.get(f);
    if (cached) return cached;
    const names: string[] = [];
    let cur: any = f;
    while (cur) {
      names.push(this.displayNameOf(cur));
      cur = cur.return;
    }
    const path = names.reverse().join('>');
    this.ownerPathCache.set(f, path);
    return path;
  }

  private sourceOf(
    fiber: any
  ): { file: string; line: number; col: number } | null {
    const s = fiber?._debugSource;
    if (s && s.fileName) {
      return {
        file: s.fileName,
        line: s.lineNumber ?? 0,
        col: s.columnNumber ?? 0,
      };
    }
    return null;
  }

  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  private filterChangesBySelector(
    changes: CommitChange[],
    selector?: Selector
  ): CommitChange[] {
    if (!selector) return changes;
    return changes.filter((ch) => {
      if (selector.keyEquals && ch.key !== selector.keyEquals) return false;
      if (!this.matchStringOrRegex(selector.displayName as any, ch.displayName))
        return false;
      if (
        selector.pathContains &&
        !(ch.path || '').includes(selector.pathContains)
      )
        return false;
      if (selector.file) {
        const file = ch.source?.file || '';
        if (!this.matchStringOrRegex(selector.file as any, file)) return false;
      }
      if (selector.costMsGte && (ch.costMs ?? 0) < selector.costMsGte)
        return false;
      if (selector.propsMatch) {
        const preview =
          ch.propDiff?.preview ?? this.lastSnapshot.get(ch.fid)?.props ?? {};
        for (const [k, v] of Object.entries(selector.propsMatch)) {
          if ((preview as any)[k] !== v) return false;
        }
      }
      return true;
    });
  }

  // Simple, cheap findings
  private buildFindings(changes: CommitChange[], commitId: number) {
    const out: any[] = [];
    const now = performance.now();
    for (const ch of changes) {
      // identityThrash: repeated prop changes
      if (ch.propDiff && ch.propDiff.changed && ch.propDiff.changed.length) {
        const s = this.propChangeStreak.get(ch.fid) || {
          count: 0,
          lastCommit: 0,
        };
        const next = {
          count: s.lastCommit === commitId - 1 ? s.count + 1 : 1,
          lastCommit: commitId,
        };
        this.propChangeStreak.set(ch.fid, next);
        if (next.count >= 3) {
          out.push({
            findingId: `${ch.fid}-thrash-${commitId}`,
            kind: 'identityThrash',
            severity: 'medium',
            fid: ch.fid,
            displayName: ch.displayName,
            evidence: { changed: ch.propDiff.changed.slice(0, 5) },
            suggestion: 'Stabilize props with useMemo/useCallback or memo().',
          });
        }
      }
      // infiniteUpdatePattern: >5 updates in 1s
      if (ch.type === 'update') {
        const arr = this.updateTimestamps.get(ch.fid) || [];
        arr.push(now);
        // keep last 10
        while (arr.length > 10) arr.shift();
        // drop old (>1s)
        const cutoff = now - 1000;
        const recent = arr.filter((t) => t >= cutoff);
        this.updateTimestamps.set(ch.fid, recent);
        if (recent.length >= 6) {
          out.push({
            findingId: `${ch.fid}-loop-${commitId}`,
            kind: 'infiniteUpdatePattern',
            severity: 'high',
            fid: ch.fid,
            displayName: ch.displayName,
            evidence: { updatesLast1s: recent.length },
            suggestion:
              'Check setState in useEffect/useLayoutEffect and ensure proper dependency arrays.',
          });
        }
      }
    }
    return out;
  }

  private buildSnapshot(
    subscriptionId: string,
    selector?: Selector,
    fields?: { props?: string[]; state?: string[]; context?: string[] }
  ) {
    const fromCommit = this.commitId;
    const rows: any[] = [];
    // Traverse current tree
    const root = (window as any).FiberDataBridge
      ?.currentRootFiber as FiberNode | null;
    const byDisplayName: Record<string, string[]> = {};
    const byFile: Record<string, string[]> = {};
    const pushRow = (fid: string, fiber: FiberNode) => {
      const displayName = this.displayNameOf(fiber);
      const path = this.ownerPath(fiber);
      const key = (fiber as any).key ?? undefined;
      const propsPreviewAll = this.safePreview((fiber as any).memoizedProps);
      let hooksPreview = this.previewHooksState((fiber as any).memoizedState);
      let contextPreview = this.previewContext(fiber);
      const propsPreview = fields?.props?.length
        ? Object.fromEntries(
            Object.entries(propsPreviewAll || {}).filter(([k]) =>
              fields!.props!.includes(k)
            )
          )
        : propsPreviewAll;
      if (fields?.state?.length) {
        hooksPreview = Object.fromEntries(
          Object.entries(hooksPreview || {}).filter(([k]) =>
            fields!.state!.includes(k)
          )
        );
      }
      if (fields?.context?.length) {
        contextPreview = Object.fromEntries(
          Object.entries(contextPreview || {}).filter(([k]) =>
            fields!.context!.includes(k)
          )
        );
      }
      const src = this.sourceOf(fiber) || undefined;
      rows.push({
        fid,
        displayName,
        path,
        key,
        propsPreview,
        hooksPreview,
        contextPreview,
        source: src,
      });
      if (displayName) {
        (byDisplayName[displayName] ||= []).push(fid);
      }
      if (src?.file) {
        (byFile[src.file] ||= []).push(fid);
      }
    };
    const matchesSelector = (fiber: FiberNode): boolean => {
      if (!selector) return true;
      const name = this.displayNameOf(fiber);
      if (!this.matchStringOrRegex(selector.displayName as any, name))
        return false;
      if (selector.file) {
        const f = this.sourceOf(fiber)?.file || '';
        if (!this.matchStringOrRegex(selector.file as any, f)) return false;
      }
      if (selector.pathContains) {
        const p = this.ownerPath(fiber);
        if (!p.includes(selector.pathContains)) return false;
      }
      if (selector.keyEquals) {
        if (((fiber as any).key ?? undefined) !== selector.keyEquals)
          return false;
      }
      if (selector.propsMatch) {
        const propsPreviewAll = this.safePreview((fiber as any).memoizedProps);
        for (const [k, v] of Object.entries(selector.propsMatch)) {
          if ((propsPreviewAll as any)?.[k] !== v) return false;
        }
      }
      return true;
    };
    const rootsToWalk: (FiberNode | null)[] = this.roots.length
      ? [...this.roots]
      : [root];
    for (const r of rootsToWalk) {
      if (!r) continue;
      this.forEachFiberInTree(r, (fiber) => {
        const fid = this.fidFor(fiber);
        if (matchesSelector(fiber)) pushRow(fid, fiber);
      });
    }
    return {
      subscriptionId,
      payload: { fromCommit, rows, indexes: { byDisplayName, byFile } },
    };
  }

  private handleDerefRequest(kind: 'props' | 'hooks', msg: MCPAgentMessage) {
    const fid = msg.fid!;
    const commitId = msg.commitId ?? this.commitId;
    const paths = msg.paths || [];
    // find closest commit in ring
    let entry = this.ringBuffer.find((e) => e.commitId === commitId);
    if (!entry) entry = this.ringBuffer[this.ringBuffer.length - 1];
    if (!entry || !entry.perFiber) {
      // Not ready or evicted
      this.channels?.send('control', {
        channel: 'control',
        type: 'NOT_READY',
        requestId: msg.requestId,
        hint: 'commitEvicted',
        latestCommit: this.commitId,
      });
      return;
    }
    const per = entry?.perFiber.get(fid) || {};
    const source = kind === 'props' ? per.props : per.hooks;
    const out: Record<string, any> = {};
    for (const p of paths) {
      out[p] = this.getAtPath(source, p);
    }
    const resp = {
      subscriptionId: undefined,
      type: 'DEREF_RESPONSE',
      requestId: msg.requestId,
      kind,
      fid,
      commitId,
      data: out,
    };
    if (this.channels) this.channels.send('control', { payload: resp });
    else if (this.isConnected && this.ws)
      this.ws.send(JSON.stringify({ channel: 'control', payload: resp }));
    else this.bufferMessage({ channel: 'control', payload: resp });
  }

  private getAtPath(obj: any, path: string): any {
    if (!obj) return undefined;
    const parts = path.split('.');
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return this.safePreview(cur);
  }

  private bufferMessage(msg: any) {
    if (this.messageBuffer.length >= this.maxBuffered)
      this.messageBuffer.shift();
    this.messageBuffer.push(msg);
  }

  private matchStringOrRegex(
    spec?: string | { $regex: string },
    val?: string
  ): boolean {
    if (!spec) return true;
    const v = val ?? '';
    if (typeof spec === 'string') {
      const looksLikeRegex =
        spec.startsWith('^') ||
        spec.endsWith('$') ||
        /[.*+?|()[\]{}\\]/.test(spec);
      return looksLikeRegex ? new RegExp(spec).test(v) : v.includes(spec);
    }
    return new RegExp(spec.$regex).test(v);
  }

  private seedCachesFromLiveTree() {
    const perFiber = new Map<
      string,
      {
        props?: any;
        state?: any;
        hooks?: any;
        context?: any;
        displayName?: string;
        ownerFid?: string;
      }
    >();
    const rootsToWalk: (FiberNode | null)[] = this.roots.length
      ? [...this.roots]
      : [(window as any).FiberDataBridge?.currentRootFiber ?? null];
    for (const r of rootsToWalk) {
      if (!r) continue;
      this.forEachFiberInTree(r, (fiber) => {
        const fid = this.fidFor(fiber);
        const props = this.safePreview((fiber as any).memoizedProps);
        const hooks = this.previewHooksState((fiber as any).memoizedState);
        const ctx = this.previewContext(fiber);
        const ownerFid = fiber.return ? this.fidFor(fiber.return) : undefined;
        const displayName = this.displayNameOf(fiber);
        this.lastSnapshot.set(fid, {
          props,
          state: Object.keys(hooks).length ? hooks : undefined,
          context: ctx,
          displayName,
          ownerFid,
        });
        perFiber.set(fid, {
          props,
          state: Object.keys(hooks).length ? hooks : undefined,
          hooks,
          context: ctx,
          displayName,
          ownerFid,
        });
      });
    }
    if (perFiber.size) {
      const latest = this.commitId; // don't invent a new commit
      const lastEntry = this.ringBuffer[this.ringBuffer.length - 1];
      if (
        this.ringBuffer.length &&
        lastEntry &&
        lastEntry.commitId === latest
      ) {
        lastEntry.perFiber = perFiber;
      } else {
        this.ringBuffer.push({ commitId: latest, perFiber });
        if (this.ringBuffer.length > this.ringSize) this.ringBuffer.shift();
      }
    }
  }
}

// Global API for agent platforms
interface ReactDebuggerMCP {
  init: (serverUrl?: string) => MCPDebuggerAgent;
  getInstance: () => MCPDebuggerAgent | null;
  getInstanceId: () => string | null;
}

let globalInstance: MCPDebuggerAgent | null = null;

// Expose global API for easy access by agent platforms
if (typeof window !== 'undefined') {
  (window as any).ReactDebuggerMCP = {
    init: (serverUrl?: string) => {
      if (globalInstance) {
        globalInstance.disconnect();
      }
      globalInstance = new MCPDebuggerAgent(serverUrl);
      return globalInstance;
    },
    getInstance: () => globalInstance,
    getInstanceId: () => globalInstance?.getInstanceId() || null,
  } as ReactDebuggerMCP;

  // Debug function to log ring buffer entries
  (window as any).logRingBufferEntries = () => {
    const instance = globalInstance;
    if (!instance) {
      return;
    }

    const ringBuffer = (instance as any).ringBuffer;
    if (!ringBuffer || ringBuffer.length === 0) {
      return;
    }
  };

  // Debug function to check if instances match
  (window as any).checkInstanceMatch = () => {
    const instance = globalInstance;
    if (!instance) {
      return;
    }
  };
}

// Auto-initialize when script is explicitly loaded (since user added script tag intentionally)
if (typeof window !== 'undefined') {
  // Check if enabled via flag OR script was explicitly loaded
  const isExplicitlyEnabled = (window as any).REACT_DEBUGGER_ENABLED;
  const isScriptLoaded = !!(window as any).ReactDebuggerMCP; // We just created this

  if (
    (isExplicitlyEnabled || isScriptLoaded) &&
    !(window as any).__MCP_AGENT_ACTIVE
  ) {
    (window as any).__MCP_AGENT_ACTIVE = true;
    (window as any).ReactDebuggerMCP.init(
      (window as any).REACT_DEBUGGER_WS_URL || undefined
    );
  }
}

declare global {
  interface Window {
    __mcpDebuggerAgent?: MCPDebuggerAgent;
    ReactDebuggerMCP?: ReactDebuggerMCP;
    logRingBufferEntries?: () => void;
    checkInstanceMatch?: () => void;
    __MCP_AGENT_ACTIVE?: boolean;
    FiberDataBridge?: {
      setCurrentRootFiber: (rootFiber: FiberNode) => void;
      currentRootFiber: FiberNode | null;
    };
  }
}

// ChannelManager with token-bucket budgets per channel
class ChannelManager {
  private ws: WebSocket;
  private buckets = new Map<
    ChannelName,
    { bytes: number; msgs: number; t: number; budget: Budget }
  >();
  private lastNoticeAt = new Map<ChannelName, number>();
  private sampleUntil = new Map<ChannelName, number>();
  private coalesceTimer: any = null;
  private pendingCommit: any | null = null;

  constructor(ws: WebSocket, defaults: Partial<Record<ChannelName, Budget>>) {
    this.ws = ws;
    const now = performance.now();
    (
      [
        'commit',
        'render',
        'findings',
        'metrics',
        'control',
        'snapshot',
      ] as ChannelName[]
    ).forEach((ch) => {
      this.buckets.set(ch, {
        bytes: 0,
        msgs: 0,
        t: now,
        budget: defaults[ch] ?? { kbPerSec: 150, msgPerSec: 20 },
      });
    });
  }

  send(ch: ChannelName, payload: any) {
    const b = this.buckets.get(ch)!;
    this.refill(b);

    const str =
      typeof payload === 'string'
        ? payload
        : JSON.stringify({ channel: ch, ...payload });
    const size = str.length;

    if (
      b.bytes + size > b.budget.kbPerSec * 1024 ||
      b.msgs + 1 > b.budget.msgPerSec
    ) {
      // Degrade per channel
      const now = Date.now();
      const last = this.lastNoticeAt.get(ch) || 0;
      const oncePerSec = now - last > 1000;
      if (ch === 'render') {
        const until = this.sampleUntil.get(ch) || 0;
        if (now > until) this.sampleUntil.set(ch, now + 1000);
        if (oncePerSec)
          this.control({ kind: 'budgetNotice', channel: ch, action: 'sample' });
        // send only 1/10 frames
        if (Math.random() < 0.9) {
          return;
        }
      } else if (ch === 'commit') {
        if (oncePerSec)
          this.control({
            kind: 'budgetNotice',
            channel: ch,
            action: 'coalesce',
          });
        // coalesce within 50ms
        const merge = (a: any, b: any) => {
          if (a && b && Array.isArray(a.changes) && Array.isArray(b.changes)) {
            const byFid = new Map<string, any>();
            for (const it of [...a.changes, ...b.changes])
              byFid.set(it.fid + ':' + it.type, it);
            a.changes = Array.from(byFid.values());
            return a;
          }
          return b || a;
        };
        this.pendingCommit = merge(this.pendingCommit, payload);
        if (!this.coalesceTimer) {
          LOG(
            `[ChannelManager.send] ⏱️ Starting coalesce timer for channel '${ch}'`
          );
          this.coalesceTimer = setTimeout(() => {
            try {
              const s = JSON.stringify({ channel: ch, ...this.pendingCommit });
              LOG(
                `[ChannelManager.send] 📤 Sending coalesced message for channel '${ch}' (${s.length} bytes)`
              );
              this.ws.send(s);
              b.bytes += s.length;
              b.msgs += 1;
            } catch (error) {
              LOG_ERROR(
                `[ChannelManager.send] ❌ Failed to send coalesced message for channel '${ch}':`,
                error
              );
            }
            this.pendingCommit = null;
            this.coalesceTimer = null;
          }, 50);
        } else {
          LOG(
            `[ChannelManager.send] ⏱️ Coalesce timer already running for channel '${ch}'`
          );
        }
        this.lastNoticeAt.set(ch, now);
        return;
      } else if (ch === 'findings') {
        LOG(`[ChannelManager.send] 📝 Channel '${ch}' summarizing findings`);
        if (oncePerSec)
          this.control({
            kind: 'budgetNotice',
            channel: ch,
            action: 'summarize',
          });
        // summarize duplicate kinds per fid
        if (payload && Array.isArray(payload.findings)) {
          const seen = new Set<string>();
          const originalCount = payload.findings.length;
          payload.findings = payload.findings.filter((f: any) => {
            const k = `${f.fid}:${f.kind}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          LOG(
            `[ChannelManager.send] 📝 Channel '${ch}' summarized ${originalCount} findings down to ${payload.findings.length}`
          );
        }
      } else {
        LOG(
          `[ChannelManager.send] ⏸️ Channel '${ch}' suspended due to rate limit`
        );
        if (oncePerSec)
          this.control({
            kind: 'budgetNotice',
            channel: ch,
            action: 'suspend',
          });
        return;
      }
      this.lastNoticeAt.set(ch, now);
    }

    try {
      LOG(`
        [ChannelManager.send] 📤 Sending message to channel '${ch}' (${str.length} bytes)`);
      this.ws.send(str);
      b.bytes += size;
      b.msgs += 1;
      LOG(
        `[ChannelManager.send] ✅ Successfully sent to channel '${ch}' - new bucket: ${
          b.bytes
        }/${b.budget.kbPerSec * 1024} bytes, ${b.msgs}/${
          b.budget.msgPerSec
        } msgs`
      );
    } catch (error) {
      LOG_ERROR(
        `[ChannelManager.send] ❌ WebSocket send failed for channel '${ch}':`,
        error
      );
      throw error;
    }
  }

  private refill(b: {
    bytes: number;
    msgs: number;
    t: number;
    budget: Budget;
  }) {
    const now = performance.now();
    const timeSinceLastRefill = now - b.t;
    if (timeSinceLastRefill >= 1000) {
      const prevBytes = b.bytes;
      const prevMsgs = b.msgs;
      b.bytes = 0;
      b.msgs = 0;
      b.t = now;
      if (prevBytes > 0 || prevMsgs > 0) {
        LOG(
          `[ChannelManager.refill] Bucket refilled after ${timeSinceLastRefill.toFixed(
            0
          )}ms - was: ${prevBytes} bytes, ${prevMsgs} msgs`
        );
      }
    }
  }

  control(msg: any) {
    this.ws.send(JSON.stringify({ channel: 'control', ...msg }));
  }
}
