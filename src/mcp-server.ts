// src/mcp-server.ts
interface McpMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class ReactMcpServer {
  // Legacy tracking removed in favor of subscribe/deref channels
  private webSocketClients = new Set<any>();
  private wsPort: number;
  // Buffer for STDIO header-based framing (Content-Length)
  private stdinBuffer: Buffer = Buffer.alloc(0);
  private useContentLengthOut: boolean = false;
  // In-memory event queues per subscription for pull-based clients
  private queues = new Map<string, any[]>();
  private pendingDerefRequests = new Map<
    string,
    { resolve: (data: any) => void; timeout: NodeJS.Timeout; startedAt: number }
  >();
  private sseController: ReadableStreamDefaultController | null = null;
  private httpResponders = new Map<string | number, (body: string) => void>();
  private protocolVersion: string = '2025-03-26'; // default if not negotiated
  // Track last seen commitId per sessionId for potential resyncs
  private lastCommitSeenBySession = new Map<string, number>();
  // Resolve the first snapshot rows for a given subscriptionId
  private firstSnapshotResolvers = new Map<
    string,
    { resolve: (rows: any[]) => void; timer: NodeJS.Timeout }
  >();

  constructor(port?: number) {
    // Redirect all console output to stderr for MCP compliance
    this.setupLogging();
    this.wsPort = Number(port || process.env.MCP_WS_PORT || 5679);
    this.setupStdioMcp();
    this.setupWebSocketServer();
  }

  private setupLogging() {
    // Override console methods to use stderr instead of stdout
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      process.stderr.write('[LOG] ' + args.join(' ') + '\n');
    };

    console.error = (...args) => {
      process.stderr.write('[ERROR] ' + args.join(' ') + '\n');
    };

    console.warn = (...args) => {
      process.stderr.write('[WARN] ' + args.join(' ') + '\n');
    };
  }

  private setupStdioMcp() {
    // Handle MCP protocol via STDIO
    process.stdin.on('data', (chunk: Buffer) => {
      // Accumulate and parse header-framed JSON-RPC (Content-Length)
      this.stdinBuffer = Buffer.concat([this.stdinBuffer, chunk]);
      while (true) {
        const sepIndex = this.stdinBuffer.indexOf('\r\n\r\n');
        if (sepIndex === -1) break; // Need more data for headers

        // Parse headers
        const headersRaw = this.stdinBuffer.slice(0, sepIndex).toString('utf8');
        const headerLines = headersRaw.split(/\r?\n/);
        let contentLength = -1;
        for (const line of headerLines) {
          const m = /^Content-Length:\s*(\d+)$/i.exec(line.trim());
          if (m && m[1] != null) {
            contentLength = parseInt(m[1]!, 10);
            break;
          }
        }
        if (contentLength < 0) {
          // Not a framed message; try NDJSON fallback if buffer starts with '{'
          break;
        }

        // We received a framed message: switch output to framed responses
        // Note: Cursor uses stdio transport; both Content-Length framed and NDJSON (newline-delimited) are acceptable per the MCP stdio spec. We auto-detect and reply in kind.
        this.useContentLengthOut = true;

        const bodyStart = sepIndex + 4; // skip \r\n\r\n
        if (this.stdinBuffer.length < bodyStart + contentLength) {
          // Wait for full body
          break;
        }

        const bodyBuf = this.stdinBuffer.slice(
          bodyStart,
          bodyStart + contentLength
        );
        // Advance buffer
        this.stdinBuffer = this.stdinBuffer.slice(bodyStart + contentLength);

        const rawMessage = bodyBuf.toString('utf8');
        console.log('[MCP Server] Received STDIO framed message:', rawMessage);
        try {
          const message: McpMessage = JSON.parse(rawMessage);
          console.log(
            '[MCP Server] Parsed STDIO message:',
            JSON.stringify(message, null, 2)
          );
          this.handleMcpMessage(message);
        } catch (error) {
          console.error('[MCP Server] Failed to parse STDIO JSON body:', error);
          // Ignore invalid JSON; do not write to stdout (would break framing)
        }
      }

      // NDJSON fallback: handle complete lines of JSON without headers
      const asString = this.stdinBuffer.toString('utf8');
      if (asString.includes('\n') && asString.trim().startsWith('{')) {
        // NDJSON mode: prefer newline-delimited output
        this.useContentLengthOut = false;
        const lines = asString.split(/\r?\n/);
        // Keep the last partial line in buffer
        const tail = lines.pop() ?? '';
        this.stdinBuffer = Buffer.from(tail, 'utf8');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg: McpMessage = JSON.parse(trimmed);
            this.handleMcpMessage(msg);
          } catch (e) {
            console.error('[MCP Server] Failed NDJSON parse:', e);
          }
        }
      }
    });

    // Don't send initial response - wait for initialize request
  }

  private async setupWebSocketServer() {
    const self = this;

    // Create WebSocket server for React app communication
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: this.wsPort,
      fetch: (req, server) => {
        // Determine allowed origins: default to loopback-only unless overridden
        const allowed = this.getAllowedOrigins();
        const origin = req.headers.get('origin');
        if (origin) {
          if (!this.isOriginAllowed(origin, allowed)) {
            return new Response('Forbidden', { status: 403 });
          }
        }
        // Capture protocol version if provided by client
        const pv = req.headers.get('mcp-protocol-version');
        if (pv) this.protocolVersion = pv;
        const url = new URL(req.url);
        // CORS preflight
        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': this.corsOriginHeader(
                origin,
                allowed
              ),
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          });
        }

        // Allow WebSocket upgrades on any path except the MCP HTTP endpoint
        if (
          url.pathname !== '/mcp' &&
          // Optional auth token check (set MCP_WS_TOKEN to enable)
          ((): boolean => {
            const token = url.searchParams.get('token');
            const expected = process.env.MCP_WS_TOKEN;
            if (expected && token !== expected) return false;
            return true;
          })() &&
          server.upgrade(req, {
            headers: origin
              ? {
                  'Access-Control-Allow-Origin': this.corsOriginHeader(
                    origin,
                    allowed
                  ),
                }
              : undefined,
          })
        ) {
          return undefined as any; // upgraded to WebSocket
        }

        // MCP endpoint supports POST and GET (SSE)
        if (url.pathname === '/mcp') {
          if (req.method === 'GET') {
            // Stream notifications via SSE
            const stream = new ReadableStream({
              start: (controller) => {
                // send open event
                controller.enqueue(ReactMcpServer.sseFormat({ type: 'open' }));
                // Close any previous SSE stream to avoid multi-stream broadcast
                if (this.sseController) {
                  try {
                    this.sseController.close();
                  } catch {}
                }
                this.sseController = controller;
              },
              cancel: () => {
                // Remove on client disconnect
                if (this.sseController) this.sseController = null;
              },
            });
            return new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'Access-Control-Allow-Origin': this.corsOriginHeader(
                  origin,
                  allowed
                ),
              },
            });
          }
          if (req.method === 'POST') {
            return req
              .json()
              .then((message: McpMessage) => {
                // Register HTTP responder for this id (if present)
                if (message && message.id !== undefined) {
                  return new Promise<Response>((resolve) => {
                    this.httpResponders.set(message.id!, (body: string) => {
                      resolve(
                        new Response(body, {
                          status: 200,
                          headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin':
                              this.corsOriginHeader(origin, allowed),
                          },
                        })
                      );
                    });
                    this.handleMcpMessage(message);
                  });
                } else {
                  // Notifications or requests without id: handle and 202
                  this.handleMcpMessage(message);
                  return new Response(null, {
                    status: 202,
                    headers: {
                      'Access-Control-Allow-Origin': this.corsOriginHeader(
                        origin,
                        allowed
                      ),
                      'Content-Type': 'application/json',
                    },
                  });
                }
              })
              .catch(
                () =>
                  new Response(
                    JSON.stringify({
                      jsonrpc: '2.0',
                      error: { code: -32700, message: 'Parse error' },
                    }),
                    {
                      status: 400,
                      headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': this.corsOriginHeader(
                          origin,
                          allowed
                        ),
                      },
                    }
                  )
              );
          }
          return new Response('Method Not Allowed', { status: 405 });
        }

        return new Response('OK', { status: 200 });
      },
      websocket: {
        message: (ws, message) => {
          this.handleWebSocketMessage(ws, message);
        },
        open: (ws) => {
          this.webSocketClients.add(ws);
          console.log('React app connected to WebSocket');
        },
        close: (ws) => {
          this.webSocketClients.delete(ws);
          console.log('React app disconnected from WebSocket');
        },
      },
    });

    console.log(`WebSocket server running on port ${this.wsPort}`);
  }

  private handleMcpMessage(message: McpMessage) {
    console.log(
      '[MCP Server] Handling MCP message:',
      message.method,
      message.id ? `(id: ${message.id})` : '(no id)'
    );

    // Validate that requests that need responses have IDs
    if (
      (message.method === 'tools/list' ||
        message.method === 'tools/call' ||
        message.method === 'initialize') &&
      message.id === undefined
    ) {
      console.error(
        '[MCP Server] Request missing required ID:',
        message.method
      );
      return;
    }

    switch (message.method) {
      case 'tools/list':
        this.sendMcpResponse({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [{ type: 'text', text: 'tools listed' }],
            tools: [
              {
                name: 'subscribe',
                description:
                  'Subscribe to channels with a selector and budgets',
                inputSchema: {
                  type: 'object',
                  properties: {
                    channels: {
                      type: 'array',
                      items: {
                        type: 'string',
                        enum: [
                          'commit',
                          'findings',
                          'snapshot',
                          'control',
                          'render',
                          'metrics',
                        ],
                      },
                      default: ['commit', 'findings'],
                    },
                    selector: {
                      type: 'object',
                      properties: {
                        displayName: {
                          type: 'string',
                          description: 'Exact or regex pattern (string form)',
                        },
                        file: {
                          type: 'string',
                          description: 'File path (exact or regex string)',
                        },
                        pathContains: { type: 'string' },
                        keyEquals: { type: 'string' },
                        costMsGte: { type: 'number' },
                        propsMatch: {
                          type: 'object',
                          additionalProperties: true,
                        },
                      },
                    },
                    fields: {
                      type: 'object',
                      description: 'Projection paths for props/state/context',
                      properties: {
                        props: { type: 'array', items: { type: 'string' } },
                        state: { type: 'array', items: { type: 'string' } },
                        context: { type: 'array', items: { type: 'string' } },
                      },
                    },
                    priority: {
                      type: 'string',
                      enum: ['high', 'normal', 'low'],
                      default: 'normal',
                    },
                    budgets: {
                      type: 'object',
                      properties: {
                        bandwidthKBs: { type: 'number' },
                        msgPerSec: { type: 'number' },
                      },
                    },
                    timeoutMs: {
                      type: 'number',
                      description:
                        'Max time to wait for first snapshot (50-1500ms). Default 250.',
                    },
                  },
                  required: [],
                },
                outputSchema: {
                  type: 'object',
                  properties: {
                    subscriptionId: { type: 'string' },
                    channels: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    selector: { type: 'object' },
                    targets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          fid: { type: 'string' },
                          displayName: { type: 'string' },
                          path: { type: 'string' },
                          key: { type: 'string' },
                          source: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
              {
                name: 'unsubscribe',
                description: 'Unsubscribe by subscriptionId',
                inputSchema: {
                  type: 'object',
                  properties: { subscriptionId: { type: 'string' } },
                  required: ['subscriptionId'],
                },
              },
              {
                name: 'nextEvents',
                description:
                  'Return and clear recent events for a subscription (commit/findings/snapshot/control).',
                inputSchema: {
                  type: 'object',
                  properties: {
                    subscriptionId: { type: 'string' },
                    max: { type: 'number', default: 50 },
                  },
                  required: ['subscriptionId'],
                },
                outputSchema: {
                  type: 'object',
                  properties: {
                    events: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
              {
                name: 'getProps',
                description:
                  'On-demand deref of props at paths for a fiber/commit',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fid: { type: 'string' },
                    commitId: {
                      type: 'number',
                      description:
                        'If omitted, the latest known commit is used.',
                    },
                    paths: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['fid', 'paths'],
                },
                outputSchema: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    kind: { type: 'string' },
                    fid: { type: 'string' },
                    commitId: { type: 'number' },
                    data: { type: 'object' },
                  },
                },
              },
              {
                name: 'getHooksState',
                description:
                  'On-demand deref of hooks state for a fiber/commit',
                inputSchema: {
                  type: 'object',
                  properties: {
                    fid: { type: 'string' },
                    commitId: {
                      type: 'number',
                      description:
                        'If omitted, the latest known commit is used.',
                    },
                    paths: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['fid', 'paths'],
                },
                outputSchema: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    kind: { type: 'string' },
                    fid: { type: 'string' },
                    commitId: { type: 'number' },
                    data: { type: 'object' },
                  },
                },
              },
              {
                name: 'ping',
                description: 'Basic health check.',
                inputSchema: { type: 'object', properties: {} },
                outputSchema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                },
              },
            ],
          },
        });
        break;

      case 'tools/call':
        this.handleToolCall(message);
        break;

      case 'initialize':
        this.sendMcpResponse({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            content: [{ type: 'text', text: 'initialized' }],
            protocolVersion: '2025-06-18',
            capabilities: {
              tools: { listChanged: true },
            },
            serverInfo: {
              name: 'react-debugger-mcp',
              version: '0.1.0',
            },
          },
        });
        break;

      default:
        this.sendMcpError(
          -32601,
          `Method not found: ${message.method}`,
          message.id
        );
    }
  }

  private async handleToolCall(message: McpMessage) {
    const { name, arguments: args } = message.params;

    switch (name) {
      case 'subscribe': {
        try {
          const subscriptionId = `sub-${Date.now()}`;
          const channels = args.channels || ['commit', 'findings'];
          const selector = args.selector || null;
          console.log(
            '[subscribe] request',
            JSON.stringify(
              {
                subscriptionId,
                channels,
                selector,
                fields: args.fields,
                budgets: args.budgets,
                timeoutMs: args?.timeoutMs,
              },
              null,
              2
            )
          );
          // Prepare a waiter for the first snapshot rows (install before broadcasting to avoid races)
          const timeoutMs = Math.min(
            Math.max((args?.timeoutMs as number) ?? 250, 50),
            1500
          );
          const rowsPromise: Promise<any[]> = new Promise<any[]>((resolve) => {
            const timer = setTimeout(() => {
              this.firstSnapshotResolvers.delete(subscriptionId);
              console.warn(
                `[subscribe] first snapshot timeout for ${subscriptionId} after ${timeoutMs}ms; returning empty targets`
              );
              resolve([]);
            }, timeoutMs);
            this.firstSnapshotResolvers.set(subscriptionId, { resolve, timer });
          });
          // Tell agent to subscribe (after installing waiter to avoid races)
          this.broadcastToWebSocketClients({
            type: 'SUBSCRIBE',
            id: subscriptionId,
            channels,
            selector: args.selector,
            fields: args.fields,
            budgets: args.budgets,
          });
          console.log(
            `[subscribe] sent SUBSCRIBE for ${subscriptionId} (channels=${channels.join(
              ','
            )})`
          );
          // Ask agent to emit a fresh snapshot immediately
          this.broadcastToWebSocketClients({
            type: 'RESYNC',
            id: subscriptionId,
            fromCommit: 0,
          });
          console.log(`[subscribe] sent RESYNC for ${subscriptionId}`);
          // Await the first snapshot rows (or timeout)
          const rows: any[] = await rowsPromise;
          console.log(
            `[subscribe] first snapshot rows for ${subscriptionId}: ${
              rows?.length ?? 0
            }`
          );

          const targets = Array.isArray(rows)
            ? rows.map((r) => ({
                fid: r.fid,
                displayName: r.displayName,
                path: r.path,
                key: r.key,
                source: r.source,
              }))
            : [];

          const status = targets.length > 0 ? 'ok' : 'empty';
          const warning =
            targets.length === 0
              ? 'Selector matched 0 fibers at snapshot time. You may RESYNC later or loosen the selector.'
              : undefined;

          this.sendMcpResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `subscribed: ${subscriptionId} (${targets.length} targets)`,
                },
                ...(warning ? [{ type: 'text', text: warning }] : []),
              ],
              subscriptionId,
              structuredContent: {
                subscriptionId,
                channels,
                selector,
                targets,
                status,
                warning,
              },
            },
          });
          console.log(
            '[subscribe] response',
            JSON.stringify(
              { subscriptionId, targetCount: targets.length },
              null,
              2
            )
          );
        } catch (error) {
          this.sendMcpError(
            -32000,
            `Failed to subscribe: ${error}`,
            message.id
          );
        }
        break;
      }

      case 'unsubscribe': {
        try {
          this.broadcastToWebSocketClients({
            type: 'UNSUBSCRIBE',
            id: args.subscriptionId,
          });
          this.sendMcpResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                { type: 'text', text: `unsubscribed: ${args.subscriptionId}` },
              ],
              ok: true,
            },
          });
        } catch (error) {
          this.sendMcpError(
            -32000,
            `Failed to unsubscribe: ${error}`,
            message.id
          );
        }
        break;
      }

      case 'getProps':
      case 'getHooksState': {
        try {
          // Guard against using a subscriptionId where a fid is expected
          const fid = String(args.fid || '');
          if (fid.startsWith('sub-')) {
            this.sendMcpError(
              -32602,
              'Expected a fid, received a subscriptionId. Call subscribe, read result.structuredContent.targets[n].fid, then call getProps/getHooksState with that fid.',
              message.id
            );
            return;
          }
          const requestId = `${name}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const payload = {
            type: name === 'getProps' ? 'GET_PROPS' : 'GET_HOOKS_STATE',
            requestId,
            fid,
            commitId: args.commitId,
            paths: args.paths || [],
          };
          console.log(
            `[deref] sending ${
              payload.type
            } requestId=${requestId} fid=${fid} commitId=${
              payload.commitId ?? 'latest'
            } paths=${(payload.paths || []).join(',')}`
          );
          const result = await this.awaitDeref(payload, requestId);
          console.log(
            `[deref] result for requestId=${requestId} kind=${result?.kind} commitId=${result?.commitId}`
          );
          this.sendMcpResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{ type: 'text', text: 'deref ok' }],
              structuredContent: result,
            },
          });
        } catch (error) {
          this.sendMcpError(-32000, `Deref failed: ${error}`, message.id);
        }
        break;
      }

      case 'nextEvents': {
        try {
          const subId: string = args.subscriptionId;
          const max: number = Math.max(1, Math.min(args.max || 50, 500));
          const q = this.queues.get(subId) || [];
          const before = q.length;
          const events = q.splice(0, max);
          this.queues.set(subId, q);
          console.log(
            `[nextEvents] sub=${subId} drained=${events.length} before=${before} after=${q.length}`
          );
          this.sendMcpResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                { type: 'text', text: `Returned ${events.length} events` },
              ],
              structuredContent: { events },
            },
          });
        } catch (error) {
          this.sendMcpError(
            -32000,
            `Failed to get events: ${error}`,
            message.id
          );
        }
        break;
      }

      case 'ping': {
        try {
          // Simple health check response
          this.sendMcpResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [{ type: 'text', text: 'pong' }],
              structuredContent: { ok: true },
            },
          });
        } catch (error) {
          this.sendMcpError(-32000, `Ping failed: ${error}`, message.id);
        }
        break;
      }

      default:
        this.sendMcpError(-32601, `Tool not found: ${name}`, message.id);
    }
  }

  // Legacy track/untrack/dump removed

  private handleWebSocketMessage(ws: any, message: string | Buffer) {
    const rawMessage = message.toString();
    console.log('[MCP Server] Received WebSocket message:', rawMessage);

    try {
      const data = JSON.parse(rawMessage);
      console.log(
        '[MCP Server] Parsed WebSocket message:',
        JSON.stringify(data, null, 2)
      );

      if (data.channel) {
        // Fulfill first-snapshot waiter for this subscription
        if (
          data.channel === 'snapshot' &&
          data.subscriptionId &&
          data.payload?.rows
        ) {
          const waiter = this.firstSnapshotResolvers.get(data.subscriptionId);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.firstSnapshotResolvers.delete(data.subscriptionId);
            try {
              console.log(
                `[ws] resolving first snapshot for ${data.subscriptionId} with ${data.payload.rows.length} rows`
              );
              waiter.resolve(data.payload.rows);
            } catch {}
          }
        }
        // If the agent explicitly says the subscription matched nothing, we can still resolve the waiter early
        if (
          data.channel === 'control' &&
          (data.type === 'SUBSCRIBE_EMPTY' ||
            data.payload?.type === 'SUBSCRIBE_EMPTY') &&
          (data.subscriptionId || data.payload?.subscriptionId)
        ) {
          const sid = data.subscriptionId || data.payload.subscriptionId;
          const waiter = this.firstSnapshotResolvers.get(sid);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.firstSnapshotResolvers.delete(sid);
            console.log(
              `[ws] resolving first snapshot for ${sid} as empty due to SUBSCRIBE_EMPTY`
            );
            try {
              waiter.resolve([]);
            } catch {}
          }
        }
        // Generic channel forwarding to MCP notifications
        if (data.channel === 'control') {
          const payload = data.payload || data;
          if (
            payload &&
            payload.type === 'DEREF_RESPONSE' &&
            payload.requestId
          ) {
            const pending = this.pendingDerefRequests.get(payload.requestId);
            if (pending) {
              clearTimeout(pending.timeout);
              this.pendingDerefRequests.delete(payload.requestId);
              // Resolve with the inner payload for clean tool results
              const dt = Date.now() - pending.startedAt;
              console.log(
                `[deref] response for requestId=${payload.requestId} in ${dt}ms kind=${payload?.kind}`
              );
              pending.resolve(payload);
            }
          }
        }
        // Track last seen commitId per session (payload-normalized)
        if (data.channel === 'commit') {
          if (data.payload && data.payload.sessionId && data.payload.commitId) {
            this.lastCommitSeenBySession.set(
              data.payload.sessionId,
              data.payload.commitId
            );
          } else if ((data as any).sessionId && (data as any).commitId) {
            // Back-compat: older agent frames had top-level fields
            this.lastCommitSeenBySession.set(
              (data as any).sessionId,
              (data as any).commitId
            );
          }
        }
        // Enqueue events for pull-based access
        const subId = data.subscriptionId || '__global__';
        const q = this.queues.get(subId) || [];
        q.push(data);
        if (q.length % 50 === 1) {
          // Periodic log to avoid excessive noise
          console.log(
            `[ws] enqueued event channel=${data.channel} sub=${subId} queueLen=${q.length}`
          );
        }
        // Cap queue size to avoid unbounded memory (keep last 1000)
        if (q.length > 1000) q.splice(0, q.length - 1000);
        this.queues.set(subId, q);
        // Always forward as notification for observability
        this.sendMcpNotification(data.channel, data);
      }
    } catch (error) {
      console.error('[MCP Server] Failed to handle WebSocket message:', error);
      console.error('[MCP Server] Raw message was:', rawMessage);
    }
  }

  private broadcastToWebSocketClients(message: any) {
    const messageStr = JSON.stringify(message);
    console.log('[MCP Server] Broadcasting to WebSocket clients:', messageStr);

    for (const client of this.webSocketClients) {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(messageStr);
      }
    }
  }

  private awaitDeref(payload: any, requestId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // timeout in 5s
      const timeout = setTimeout(() => {
        this.pendingDerefRequests.delete(requestId);
        reject(new Error('Timeout waiting for deref'));
      }, 5000);
      const startedAt = Date.now();
      this.pendingDerefRequests.set(requestId, { resolve, timeout, startedAt });
      this.broadcastToWebSocketClients(payload);
    });
  }

  private sendMcpResponse(response: McpResponse) {
    const responseStr = JSON.stringify(response);
    if (this.useContentLengthOut) {
      const header = `Content-Length: ${Buffer.byteLength(
        responseStr,
        'utf8'
      )}\r\n\r\n`;
      process.stdout.write(header + responseStr);
    } else {
      // Newline-delimited JSON per MCP stdio transport (2025-06-18)
      process.stdout.write(responseStr + '\n');
    }
    // If there's a pending HTTP responder for this id, fulfill it as well
    if (response.id !== undefined && this.httpResponders.has(response.id)) {
      const cb = this.httpResponders.get(response.id)!;
      this.httpResponders.delete(response.id);
      try {
        cb(responseStr);
      } catch {}
    }
  }

  private sendMcpError(code: number, message: string, id?: string | number) {
    if (id === undefined) {
      console.error(
        '[MCP Server] Error: trying to send error response without ID'
      );
      return;
    }

    const errorResponse: McpResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    this.sendMcpResponse(errorResponse);
  }

  private sendMcpNotification(method: string, params: any) {
    const notification = {
      jsonrpc: '2.0',
      method: `notifications/${method}`,
      params,
    };
    const notificationStr = JSON.stringify(notification);
    if (this.useContentLengthOut) {
      const header = `Content-Length: ${Buffer.byteLength(
        notificationStr,
        'utf8'
      )}\r\n\r\n`;
      process.stdout.write(header + notificationStr);
    } else {
      process.stdout.write(notificationStr + '\n');
    }
    // Fan out to SSE clients
    this.broadcastSse(notification);
  }

  private broadcastSse(payload: any) {
    if (!this.sseController) return;
    const data = ReactMcpServer.sseFormat(payload);
    try {
      this.sseController.enqueue(data);
    } catch {
      this.sseController = null;
    }
  }

  private static sseFormat(obj: any): Uint8Array {
    const str = `data: ${JSON.stringify(obj)}\n\n`;
    return new TextEncoder().encode(str);
  }

  private getAllowedOrigins(): Set<string> {
    const env = (process.env.MCP_ALLOWLIST || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return new Set(env); // if empty, we treat loopback as allowed by default in isOriginAllowed
  }

  private isOriginAllowed(origin: string, allowlist: Set<string>): boolean {
    // If explicit allowlist provided, require exact match
    if (allowlist.size > 0) return allowlist.has(origin);
    try {
      const u = new URL(origin);
      const host = u.hostname;
      return host === 'localhost' || host === '127.0.0.1';
    } catch {
      return false;
    }
  }

  private corsOriginHeader(
    origin: string | null,
    allowed: Set<string>
  ): string {
    if (origin && this.isOriginAllowed(origin, allowed)) return origin;
    // For non-browser clients (no Origin), use loopback default
    return 'http://localhost';
  }
}

export async function startMcpServer(port?: number) {
  // Don't log to stdout - MCP clients expect only JSON-RPC messages
  process.stderr.write(
    `Starting React Debugger MCP Server (ws port=${
      port || process.env.MCP_WS_PORT || 5679
    })...\n`
  );
  const server = new ReactMcpServer(port);

  // Keep process alive
  process.on('SIGINT', () => {
    process.stderr.write('Shutting down MCP server...\n');
    process.exit();
  });

  return server;
}
