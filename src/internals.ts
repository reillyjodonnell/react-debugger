// Don't change these values. They're used by React Dev Tools.
export const NoFlags = /*                      */ 0b0000000000000000000000000000000;
export const PerformedWork = /*                */ 0b0000000000000000000000000000001;
export const Placement = /*                    */ 0b0000000000000000000000000000010;
export const DidCapture = /*                   */ 0b0000000000000000000000010000000;
export const Hydrating = /*                    */ 0b0000000000000000001000000000000;

// You can change the rest (and add more).
export const Update = /*                       */ 0b0000000000000000000000000000100;
export const Cloned = /*                       */ 0b0000000000000000000000000001000;

export const ChildDeletion = /*                */ 0b0000000000000000000000000010000;
export const ContentReset = /*                 */ 0b0000000000000000000000000100000;
export const Callback = /*                     */ 0b0000000000000000000000001000000;
/* Used by DidCapture:                            0b0000000000000000000000010000000; */

export const ForceClientRender = /*            */ 0b0000000000000000000000100000000;
export const Ref = /*                          */ 0b0000000000000000000001000000000;
export const Snapshot = /*                     */ 0b0000000000000000000010000000000;
export const Passive = /*                      */ 0b0000000000000000000100000000000;
/* Used by Hydrating:                             0b0000000000000000001000000000000; */

export const Visibility = /*                   */ 0b0000000000000000010000000000000;
export const StoreConsistency = /*             */ 0b0000000000000000100000000000000;

// It's OK to reuse these bits because these flags are mutually exclusive for
// different fiber types. We should really be doing this for as many flags as
// possible, because we're about to run out of bits.
export const ScheduleRetry = StoreConsistency;
export const ShouldSuspendCommit = Visibility;
export const DidDefer = ContentReset;
export const FormReset = Snapshot;
export const AffectedParentLayout = ContentReset;

export const LifecycleEffectMask =
  Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

// Union of all commit flags (flags with the lifetime of a particular commit)
export const HostEffectMask = /*               */ 0b0000000000000000111111111111111;

// These are not really side effects, but we still reuse this field.
export const Incomplete = /*                   */ 0b0000000000000001000000000000000;
export const ShouldCapture = /*                */ 0b0000000000000010000000000000000;
export const ForceUpdateForLegacySuspense = /* */ 0b0000000000000100000000000000000;
export const DidPropagateContext = /*          */ 0b0000000000001000000000000000000;
export const NeedsPropagation = /*             */ 0b0000000000010000000000000000000;
export const Forked = /*                       */ 0b0000000000100000000000000000000;

// Static tags describe aspects of a fiber that are not specific to a render,
// e.g. a fiber uses a passive effect (even if there are no updates on this particular render).
// This enables us to defer more work in the unmount case,
// since we can defer traversing the tree during layout to look for Passive effects,
// and instead rely on the static flag as a signal that there may be cleanup work.
export const SnapshotStatic = /*               */ 0b0000000001000000000000000000000;
export const LayoutStatic = /*                 */ 0b0000000010000000000000000000000;
export const RefStatic = LayoutStatic;
export const PassiveStatic = /*                */ 0b0000000100000000000000000000000;
export const MaySuspendCommit = /*             */ 0b0000001000000000000000000000000;
// ViewTransitionNamedStatic tracks explicitly name ViewTransition components deeply
// that might need to be visited during clean up. This is similar to SnapshotStatic
// if there was any other use for it.
export const ViewTransitionNamedStatic = /*    */ SnapshotStatic;
// ViewTransitionStatic tracks whether there are an ViewTransition components from
// the nearest HostComponent down. It resets at every HostComponent level.
export const ViewTransitionStatic = /*         */ 0b0000010000000000000000000000000;
const OFFSET = 2; // px
function highlightRenderForElement(element: HTMLElement) {
  return;
  const rect = element.getBoundingClientRect();
  if (!rect) {
    console.log('Element has no bounding rect');
    return;
  }
  const highlight = document.createElement('div');
  highlight.style.position = 'fixed';
  highlight.style.top = `${rect.top}px`;
  highlight.style.left = `${rect.left}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
  highlight.style.zIndex = '999999999';
  highlight.style.outline = '2px solid rgb(78, 205, 196)';
  highlight.style.outlineOffset = `${OFFSET}px`;
  highlight.style.pointerEvents = 'none';
  highlight.style.transition = 'outline-offset 0.3s ease-in-out';
  highlight.style.backgroundColor = 'rgba(78, 205, 196, 0.1)';
  highlight.style.borderRadius = '4px';
  document.documentElement.appendChild(highlight);
  setTimeout(() => {
    document.documentElement.removeChild(highlight);
  }, 300);
}

const HTMLMap = new Map<HTMLElement, FiberNode>();

const ComponentMap = new Map<FiberNode, Function>();

// Dictionary mapping breakpoint numbers to Fiber instances with render count tracking
const BreakpointFiberMap = new Map<
  string,
  { fiber: FiberNode; renderCount: number }
>();

// Global bridge for accessing fiber data from debugger widget
if (typeof window !== 'undefined') {
  (window as any).FiberDataBridge = {
    // Set the current root fiber for data extraction
    setCurrentRootFiber: (rootFiber: FiberNode) => {
      (window as any).FiberDataBridge.currentRootFiber = rootFiber;
    },

    // Get fiber by breakpoint number
    getFiberByBreakpoint: (breakpointNumber: string): FiberNode | null => {
      const entry = BreakpointFiberMap.get(breakpointNumber);
      return entry ? entry.fiber : null;
    },

    // Set fiber for a breakpoint number
    setFiberForBreakpoint: (breakpointNumber: string, fiber: FiberNode) => {
      BreakpointFiberMap.set(breakpointNumber, { fiber, renderCount: 0 });
    },

    // Remove fiber for a breakpoint number
    removeFiberForBreakpoint: (breakpointNumber: string) => {
      BreakpointFiberMap.delete(breakpointNumber);
    },

    // Get all breakpoint fibers
    getAllBreakpointFibers: (): Map<string, FiberNode> => {
      const result = new Map<string, FiberNode>();
      for (const [breakpointNumber, entry] of BreakpointFiberMap.entries()) {
        result.set(breakpointNumber, entry.fiber);
      }
      return result;
    },

    // Get component data for a breakpoint
    getComponentDataForBreakpoint: (breakpointNumber: string) => {
      const entry = BreakpointFiberMap.get(breakpointNumber);
      if (!entry) return null;

      // Get the current fiber instance from the current fiber tree
      const currentRootFiber = (window as any).FiberDataBridge.currentRootFiber;
      if (!currentRootFiber) return null;

      // Find the current fiber instance for this component
      let currentFiber: FiberNode | null = null;
      const allFibers = getAllFibers(currentRootFiber);

      for (const fiber of allFibers) {
        if (
          typeof fiber.type === 'function' &&
          typeof entry.fiber.type === 'function'
        ) {
          if (
            fiber.type === entry.fiber.type ||
            fiber.type.name === entry.fiber.type.name
          ) {
            currentFiber = fiber;
            break;
          }
        }
      }

      if (!currentFiber) {
        console.warn(
          `Current fiber not found for breakpoint ${breakpointNumber}`
        );
        return null;
      }

      return extractFiberData(currentFiber);
    },

    // Get all breakpoint component data
    getAllBreakpointComponentData: () => {
      const result: Record<string, any> = {};
      const currentRootFiber = (window as any).FiberDataBridge.currentRootFiber;

      if (!currentRootFiber) return result;

      const allFibers = getAllFibers(currentRootFiber);

      for (const [breakpointNumber, entry] of BreakpointFiberMap.entries()) {
        // Find the current fiber instance for this component
        let currentFiber: FiberNode | null = null;

        for (const fiber of allFibers) {
          if (
            typeof fiber.type === 'function' &&
            typeof entry.fiber.type === 'function'
          ) {
            if (
              fiber.type === entry.fiber.type ||
              fiber.type.name === entry.fiber.type.name
            ) {
              currentFiber = fiber;
              break;
            }
          }
        }

        if (currentFiber) {
          result[breakpointNumber] = extractFiberData(currentFiber);
        } else {
          console.warn(
            `Current fiber not found for breakpoint ${breakpointNumber}`
          );
        }
      }

      return result;
    },

    // Get render count for a breakpoint
    getRenderCount: (breakpointNumber: string): number => {
      const entry = BreakpointFiberMap.get(breakpointNumber);
      const count = entry ? entry.renderCount : 0;
      console.log(
        `Getting render count for breakpoint ${breakpointNumber}: ${count}`
      );
      return count;
    },

    // Increment render count for a breakpoint
    incrementRenderCount: (breakpointNumber: string) => {
      const entry = BreakpointFiberMap.get(breakpointNumber);
      if (entry) {
        entry.renderCount += 1;
        console.log(
          `Incremented render count for breakpoint ${breakpointNumber}: ${entry.renderCount}`
        );
      } else {
        console.warn(
          `No entry found for breakpoint ${breakpointNumber} when trying to increment render count`
        );
      }
    },

    // Reset render count for a breakpoint
    resetRenderCount: (breakpointNumber: string) => {
      const entry = BreakpointFiberMap.get(breakpointNumber);
      if (entry) {
        entry.renderCount = 0;
      }
    },

    // Get all render counts
    getAllRenderCounts: (): Map<string, number> => {
      const result = new Map<string, number>();
      for (const [breakpointNumber, entry] of BreakpointFiberMap.entries()) {
        result.set(breakpointNumber, entry.renderCount);
      }
      return result;
    },

    // Current root fiber for traversal
    currentRootFiber: null as FiberNode | null,
  };
}

export function getFiberFromElement(
  element: HTMLElement
): FiberNode | undefined {
  return HTMLMap.get(element);
}

function traverseFiber(fiber: FiberNode | null, isRoot = false) {
  if (!fiber) return;

  if (isRoot) {
    console.log('Root fiber:', fiber);
    if (fiber.child) traverseFiber(fiber.child);
    return;
  }

  if (fiber.stateNode instanceof HTMLElement) {
    HTMLMap.set(fiber.stateNode, fiber);
    if (fiber.flags === Update) {
      highlightRenderForElement(fiber.stateNode);
    }
  }

  if (typeof fiber.elementType === 'function') {
    ComponentMap.set(fiber, fiber.elementType);
  }

  if (fiber.sibling) {
    traverseFiber(fiber.sibling);
  }
  if (fiber.child) {
    traverseFiber(fiber.child);
  }
}

// Component source location cache
const ComponentSourceMap = new Map<
  Function,
  { file: string; line: number } | null
>();

// Override with your own implementation
if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    checkDCE: () => {},
    supportsFiber: true,
    renderers: new Map(),
    onScheduleFiberRoot: () => {},
    onCommitFiberRoot: () => {},
    onCommitFiberUnmount: () => {},
    inject: (renderer: any) => 0,
  };
}

// Store the original onCommitFiberRoot if it exists
const originalOnCommitFiberRoot = (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as any)
  .onCommitFiberRoot;

// Override onCommitFiberRoot with our implementation
(window.__REACT_DEVTOOLS_GLOBAL_HOOK__ as any).onCommitFiberRoot = function (
  id: any,
  root: any,
  priorityLevel: any,
  ...rest: any[]
) {
  console.log('onCommitFiberRoot called - tracking renders');

  traverseFiber(root.current, true);

  // Check for component renders in the fiber tree
  checkForComponentRenders(root.current);

  // Set the current root fiber for data extraction
  if (typeof window !== 'undefined' && (window as any).FiberDataBridge) {
    (window as any).FiberDataBridge.setCurrentRootFiber(root.current);
  }

  // Call the original function if it exists
  if (originalOnCommitFiberRoot) {
    originalOnCommitFiberRoot(id, root, priorityLevel, ...rest);
  }
};

// Function to capture component source location during execution
function captureComponentSource(
  componentType: Function
): { file: string; line: number } | null {
  // Check cache first
  if (ComponentSourceMap.has(componentType)) {
    return ComponentSourceMap.get(componentType) || null;
  }

  try {
    // Create a wrapper that captures the stack trace when the component executes
    const originalComponent = componentType;
    const wrappedComponent = function (...args: any[]) {
      // Capture stack trace during component execution
      const error = new Error();
      const stack = error.stack || '';

      // Parse the stack trace to find the component's source location
      const sourceLocation = parseComponentStack(
        stack,
        originalComponent.name || ''
      );

      // Cache the result
      ComponentSourceMap.set(originalComponent, sourceLocation);

      // Call the original component
      return originalComponent.apply(null, args);
    };

    // Copy the original component's properties
    Object.setPrototypeOf(
      wrappedComponent,
      Object.getPrototypeOf(originalComponent)
    );
    Object.defineProperty(wrappedComponent, 'name', {
      value: originalComponent.name,
    });

    // Replace the component in the fiber
    return null; // Will be populated on first execution
  } catch (e) {
    console.error('Error capturing component source:', e);
    ComponentSourceMap.set(componentType, null);
    return null;
  }
}

function parseComponentStack(
  stack: string,
  componentName: string
): { file: string; line: number } | null {
  const lines = stack.split('\n');

  for (const line of lines) {
    // Look for the component function in the stack
    // Pattern: "at ComponentName (file:line:column)"
    const match = line.match(/at\s+(\w+)\s+\((.+?):(\d+):(\d+)\)/);

    if (match) {
      const [, funcName, file, lineNum, column] = match;

      // Check if this is our component
      if (funcName === componentName && file) {
        return {
          file: file || '',
          line: parseInt(lineNum || '0'),
        };
      }
    }
  }

  return null;
}

// Export the function to get component source location
export function getComponentSourceLocation(
  componentType: Function
): { file: string; line: number } | null {
  return ComponentSourceMap.get(componentType) || null;
}

// Canvas overlay handles highlighting now - removed old DOM-based highlighting

// --- Fiber Data Export for Canvas Overlay ---

export function getFiberRects() {
  const rects: Array<{
    element: HTMLElement;
    rect: DOMRect;
    fiberNode: FiberNode;
  }> = [];
  for (const [element, fiberNode] of HTMLMap.entries()) {
    const rect = element.getBoundingClientRect();
    if (rect) {
      rects.push({ element, rect, fiberNode });
    }
  }
  return rects;
}

export function getComponentNameForElement(
  el: HTMLElement
): string | undefined {
  const fiber = HTMLMap.get(el);
  if (!fiber) return undefined;
  if (typeof fiber.type === 'function') return fiber.type.name || '(anonymous)';
  if (typeof fiber.type === 'string') return fiber.type;
  return undefined;
}

export type FiberNode = {
  child: FiberNode | null;
  flags: number; // a bitmask of flags / arbitrary values to signal
  stateNode: HTMLElement | null; // DOM element associated with this fiber
  type: string | Function | symbol;
  elementType?: any;
  return: FiberNode | null; // Parent fiber
  sibling: FiberNode | null;
  // Add the missing properties we need for data extraction
  memoizedProps?: any;
  memoizedState?: any;
  pendingProps?: any;
  updateQueue?: any;
  alternate?: FiberNode | null;
  key?: string | null;
  tag?: number;
  mode?: number;
  lanes?: number;
  childLanes?: number;
  index?: number;
  ref?: any;
  actualStartTime?: number;
  actualDuration?: number;
  selfBaseDuration?: number;
  treeBaseDuration?: number;
  _debugSource?: any;
  _debugOwner?: FiberNode | null;
  _debugIsCurrentlyTiming?: boolean;
  _debugNeedsRemount?: boolean;
  _debugHookTypes?: any;
};

// Hook types for identification
export const HookTypes = {
  useState: 0,
  useEffect: 1,
  useContext: 2,
  useReducer: 3,
  useCallback: 4,
  useMemo: 5,
  useRef: 6,
  useImperativeHandle: 7,
  useLayoutEffect: 8,
  useDebugValue: 9,
  useDeferredValue: 10,
  useTransition: 11,
  useId: 12,
  useSyncExternalStore: 13,
  useInsertionEffect: 14,
} as const;

// Extract real props from a fiber
export function extractFiberProps(fiber: FiberNode): Record<string, any> {
  if (!fiber) return {};

  const props: Record<string, any> = {};

  // Get current props
  if (fiber.memoizedProps) {
    Object.assign(props, fiber.memoizedProps);
  }

  // Get pending props if different
  if (fiber.pendingProps && fiber.pendingProps !== fiber.memoizedProps) {
    Object.assign(props, fiber.pendingProps);
  }

  return props;
}

// Extract real state from a fiber
export function extractFiberState(fiber: FiberNode): Record<string, any> {
  if (!fiber) return {};

  const state: Record<string, any> = {};

  // For function components, state is in memoizedState
  if (fiber.memoizedState) {
    // Handle different types of state
    if (typeof fiber.memoizedState === 'object') {
      // Could be useState, useReducer, etc.
      if (fiber.memoizedState.baseState !== undefined) {
        // useReducer
        state.reducer = fiber.memoizedState.baseState;
      } else if (fiber.memoizedState.memoizedState !== undefined) {
        // useState
        state.state = fiber.memoizedState.memoizedState;
      }
    }
  }

  return state;
}

// Extract hooks from a fiber
export function extractFiberHooks(fiber: FiberNode): Array<{
  type: string;
  value: any;
  index: number;
  hookType?: string;
}> {
  if (!fiber) return [];

  const hooks: Array<{
    type: string;
    value: any;
    index: number;
    hookType?: string;
  }> = [];

  let currentHook = fiber.memoizedState;
  let hookIndex = 0;

  while (currentHook) {
    const hookType = getHookType(currentHook);
    const hookData = {
      type: hookType,
      value: currentHook.memoizedState,
      index: hookIndex,
      hookType: hookType,
    };

    hooks.push(hookData);

    currentHook = currentHook.next;
    hookIndex++;
  }

  return hooks;
}

// Determine hook type based on hook structure
function getHookType(hook: any): string {
  if (!hook) return 'unknown';

  // useEffect, useLayoutEffect, useInsertionEffect
  if (hook.memoizedState !== null && typeof hook.memoizedState === 'object') {
    if (
      hook.memoizedState.hasOwnProperty('destroy') ||
      hook.memoizedState.hasOwnProperty('create')
    ) {
      return 'useEffect';
    }
  }

  // useState/useReducer (both use the same underlying mechanism)
  if (hook.queue && hook.queue.lastRenderedReducer) {
    // Check if it's the basic state reducer (useState) vs custom reducer
    const isBasicStateReducer =
      hook.queue.lastRenderedReducer.name === 'basicStateReducer';
    return isBasicStateReducer ? 'useState' : 'useReducer';
  }

  // useMemo/useCallback (both cache [value, deps])
  if (Array.isArray(hook.memoizedState) && hook.memoizedState.length === 2) {
    // This is tricky to distinguish - both store [value, deps]
    // You'd need to look at the cached value type
    return typeof hook.memoizedState[0] === 'function'
      ? 'useCallback'
      : 'useMemo';
  }

  // useRef (memoizedState is the ref object itself)
  if (
    hook.memoizedState &&
    typeof hook.memoizedState === 'object' &&
    hook.memoizedState.hasOwnProperty('current')
  ) {
    return 'useRef';
  }

  // useContext
  if (hook.memoizedState && hook.memoizedState._context) {
    return 'useContext';
  }

  return 'unknown';
}

// Get component context values
export function extractFiberContext(fiber: FiberNode): Record<string, any> {
  if (!fiber) return {};

  const context: Record<string, any> = {};

  // Traverse up the fiber tree to find context providers
  let currentFiber: FiberNode | null = fiber;
  while (currentFiber) {
    if (currentFiber.type && typeof currentFiber.type === 'object') {
      // Check if this is a Context.Provider
      const type = currentFiber.type as any;
      if (type.$$typeof === Symbol.for('react.context')) {
        const contextName = type._context?.displayName || 'Context';
        context[contextName] = currentFiber.memoizedProps?.value;
      }
    }
    currentFiber = currentFiber.return;
  }

  return context;
}

// Comprehensive fiber data extraction
export function extractFiberData(fiber: FiberNode): {
  props: Record<string, any>;
  state: Record<string, any>;
  hooks: Array<{ type: string; value: any; index: number; hookType?: string }>;
  context: Record<string, any>;
  componentName: string;
  renderCount: number;
  lastRenderTime: number;
} {
  if (!fiber) {
    return {
      props: {},
      state: {},
      hooks: [],
      context: {},
      componentName: 'Unknown',
      renderCount: 0,
      lastRenderTime: 0,
    };
  }

  const componentName = getComponentName(fiber);
  const props = extractFiberProps(fiber);
  const state = extractFiberState(fiber);
  const hooks = extractFiberHooks(fiber);
  const context = extractFiberContext(fiber);

  // Get render count from our tracking system
  let renderCount = 0;
  if (typeof window !== 'undefined' && (window as any).FiberDataBridge) {
    const bridge = (window as any).FiberDataBridge;
    const breakpointFibers = bridge.getAllBreakpointFibers();

    // Find which breakpoint is tracking this fiber by component type
    for (const [
      breakpointNumber,
      breakpointFiber,
    ] of breakpointFibers.entries()) {
      if (
        typeof fiber.type === 'function' &&
        typeof breakpointFiber.type === 'function'
      ) {
        if (
          fiber.type === breakpointFiber.type ||
          fiber.type.name === breakpointFiber.type.name
        ) {
          renderCount = bridge.getRenderCount(breakpointNumber);
          break;
        }
      }
    }
  }
  const lastRenderTime = fiber.actualStartTime || Date.now();

  return {
    props,
    state,
    hooks,
    context,
    componentName,
    renderCount,
    lastRenderTime,
  };
}

// Get component name from fiber
function getComponentName(fiber: FiberNode): string {
  if (!fiber) return 'Unknown';

  if (typeof fiber.type === 'function') {
    return fiber.type.name || 'Anonymous';
  }

  if (typeof fiber.type === 'string') {
    return fiber.type;
  }

  if (fiber.type && typeof fiber.type === 'object') {
    const type = fiber.type as any;
    return type.displayName || 'Context';
  }

  return 'Unknown';
}

// Get all fibers in the tree
export function getAllFibers(rootFiber: FiberNode): FiberNode[] {
  const fibers: FiberNode[] = [];

  function traverse(fiber: FiberNode | null) {
    if (!fiber) return;

    fibers.push(fiber);

    if (fiber.child) {
      traverse(fiber.child);
    }

    if (fiber.sibling) {
      traverse(fiber.sibling);
    }
  }

  traverse(rootFiber);
  return fibers;
}

// Find fiber by component name
export function findFiberByName(
  rootFiber: FiberNode,
  componentName: string
): FiberNode | null {
  const fibers = getAllFibers(rootFiber);
  return (
    fibers.find((fiber) => getComponentName(fiber) === componentName) || null
  );
}

// Find fiber by DOM element
export function findFiberByElement(
  rootFiber: FiberNode,
  element: HTMLElement
): FiberNode | null {
  const fibers = getAllFibers(rootFiber);
  return fibers.find((fiber) => fiber.stateNode === element) || null;
}

// Function to associate a breakpoint with a component fiber
export function associateBreakpointWithComponent(
  breakpointNumber: string,
  componentName: string
): boolean {
  if (typeof window === 'undefined' || !(window as any).FiberDataBridge) {
    console.warn('FiberDataBridge not available');
    return false;
  }

  const bridge = (window as any).FiberDataBridge;
  const rootFiber = bridge.currentRootFiber;

  if (!rootFiber) {
    console.warn('No root fiber available');
    return false;
  }

  const fiber = findFiberByName(rootFiber, componentName);
  if (!fiber) {
    console.warn(`Component '${componentName}' not found in fiber tree`);
    return false;
  }

  bridge.setFiberForBreakpoint(breakpointNumber, fiber);
  console.log(
    `Associated breakpoint ${breakpointNumber} with component ${componentName}`
  );
  return true;
}

// Function to get all breakpoint component data
export function getAllBreakpointComponentData(): Record<string, any> {
  if (typeof window === 'undefined' || !(window as any).FiberDataBridge) {
    return {};
  }

  return (window as any).FiberDataBridge.getAllBreakpointComponentData();
}

// Function to remove breakpoint association
export function removeBreakpointAssociation(breakpointNumber: string): boolean {
  if (typeof window === 'undefined' || !(window as any).FiberDataBridge) {
    console.warn('FiberDataBridge not available');
    return false;
  }

  const bridge = (window as any).FiberDataBridge;
  bridge.removeFiberForBreakpoint(breakpointNumber);
  console.log(`Removed breakpoint association for ${breakpointNumber}`);
  return true;
}

// Function to reset all render counts
export function resetAllRenderCounts(): boolean {
  if (typeof window === 'undefined' || !(window as any).FiberDataBridge) {
    console.warn('FiberDataBridge not available');
    return false;
  }

  const bridge = (window as any).FiberDataBridge;
  const breakpointFibers = bridge.getAllBreakpointFibers();

  for (const breakpointNumber of breakpointFibers.keys()) {
    bridge.resetRenderCount(breakpointNumber);
  }

  console.log('Reset all render counts');
  return true;
}

// Function to get render count for a specific component
export function getComponentRenderCount(componentName: string): number {
  if (typeof window === 'undefined' || !(window as any).FiberDataBridge) {
    return 0;
  }

  const bridge = (window as any).FiberDataBridge;
  const rootFiber = bridge.currentRootFiber;

  if (!rootFiber) {
    return 0;
  }

  const fiber = findFiberByName(rootFiber, componentName);
  if (!fiber) {
    return 0;
  }

  // Find which breakpoint is tracking this fiber
  const breakpointFibers = bridge.getAllBreakpointFibers();
  for (const [
    breakpointNumber,
    breakpointFiber,
  ] of breakpointFibers.entries()) {
    if (breakpointFiber === fiber) {
      return bridge.getRenderCount(breakpointNumber);
    }
  }

  return 0;
}

declare global {
  interface Window {
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
      checkDCE: () => void;
      supportsFiber: boolean;
      renderers: Map<number, any>;
      onScheduleFiberRoot: () => void;
      onCommitFiberRoot: (rendererID: number, root: any) => void;
      onCommitFiberUnmount: () => void;
      inject: (renderer: any) => number;
    };
  }
}

// Function to check for component renders in the fiber tree
function checkForComponentRenders(fiber: FiberNode | null) {
  if (!fiber) return;

  // Check if this fiber performed work (rendered/re-rendered)
  const performedWork = (fiber.flags & PerformedWork) !== 0;
  const hasPropsUpdate = fiber.pendingProps !== fiber.memoizedProps;
  const hasStateUpdate = fiber.updateQueue !== null;

  // If this fiber performed work, check if it's being tracked
  if (performedWork || hasPropsUpdate || hasStateUpdate) {
    console.log(
      `Component ${
        typeof fiber.type === 'function' && fiber.type.name
      } rendered - performedWork: ${performedWork}, hasPropsUpdate: ${hasPropsUpdate}, hasStateUpdate: ${hasStateUpdate}`
    );
    if (typeof window !== 'undefined' && (window as any).FiberDataBridge) {
      const bridge = (window as any).FiberDataBridge;
      const breakpointFibers = bridge.getAllBreakpointFibers();

      // Check if this fiber is being tracked by any breakpoint
      console.log(
        `Checking ${breakpointFibers.size} breakpoints for component ${
          typeof fiber.type === 'function' ? fiber.type.name : 'unknown'
        }`
      );

      for (const [
        breakpointNumber,
        breakpointFiber,
      ] of breakpointFibers.entries()) {
        // Compare by component type/name instead of fiber instance
        if (
          typeof fiber.type === 'function' &&
          typeof breakpointFiber.type === 'function'
        ) {
          const componentMatch =
            fiber.type === breakpointFiber.type ||
            fiber.type.name === breakpointFiber.type.name;
          console.log(
            `Comparing ${fiber.type.name} with ${breakpointFiber.type.name}: ${componentMatch}`
          );

          if (componentMatch) {
            bridge.incrementRenderCount(breakpointNumber);
            console.log(
              `Component render detected for breakpoint ${breakpointNumber}: ${getComponentName(
                fiber
              )}`
            );

            // Send updated component data to debugger widget
            sendComponentDataUpdateToDebugger(breakpointNumber, fiber);

            break;
          }
        }
      }
    }
  }

  // Recursively check children and siblings
  if (fiber.child) {
    checkForComponentRenders(fiber.child);
  }
  if (fiber.sibling) {
    checkForComponentRenders(fiber.sibling);
  }
}

// Function to send component data updates to debugger widget
function sendComponentDataUpdateToDebugger(
  breakpointNumber: string,
  fiber: FiberNode
) {
  if (typeof window === 'undefined') return;

  // Check if there's a debugger window to send data to
  const debuggerWindow = (window as any).__reactDebuggerOverlay?.debuggerWindow;
  console.log('Debugger window state:', {
    exists: !!debuggerWindow,
    closed: debuggerWindow?.closed,
    origin: (window as any).__reactDebuggerOverlay?.debuggerWindowOrigin,
  });

  if (!debuggerWindow || debuggerWindow.closed) {
    console.log(
      'Debugger window not available for sending component data update'
    );
    return;
  }

  // Get the updated component data
  const componentData = extractFiberData(fiber);

  // Send the update to the debugger widget
  try {
    debuggerWindow.postMessage(
      {
        type: 'COMPONENT_DATA_UPDATE',
        payload: {
          breakpointNumber,
          componentData,
          timestamp: Date.now(),
        },
      },
      (window as any).__reactDebuggerOverlay?.debuggerWindowOrigin || '*'
    );

    console.log(
      `Sent component data update for breakpoint ${breakpointNumber} to debugger widget:`,
      componentData
    );
  } catch (error) {
    console.error('Error sending component data update:', error);
  }
}
