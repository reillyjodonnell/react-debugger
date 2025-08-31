// src/index.tsx
// React Debugger: High-performance canvas overlay + React UI

import { getFiberFromElement, type FiberNode } from './internals';

export interface DebuggerOptions {
  port?: number;
  overlay?: boolean;
  console?: boolean;
  network?: boolean;
  performance?: boolean;
}

// derived from react's approach s/o to them
class SafeComponentStackGenerator {
  private componentFrameCache: Map<Function, any>;
  private reentry: boolean;

  constructor() {
    this.componentFrameCache = new Map();
    this.reentry = false;
  }

  getComponentSourceLocation(
    componentFunction: Function
  ): { file: string; line: number; column: number } | null {
    // Check cache first
    if (this.componentFrameCache.has(componentFunction)) {
      return this.componentFrameCache.get(componentFunction);
    }

    // Prevent re-entry
    if (!componentFunction || this.reentry) {
      return null;
    }

    this.reentry = true;
    let control: Error | null = null;

    // Save current React state
    const previousPrepareStackTrace = (Error as any).prepareStackTrace;
    (Error as any).prepareStackTrace = undefined;

    // Mock React dispatcher to prevent side effects
    let previousDispatcher: any = null;
    try {
      previousDispatcher = this.getMockDispatcher();
    } catch (error) {
      console.warn('Failed to mock React dispatcher:', error);
    }

    try {
      // Determine if it's a class or function component
      const isClassComponent =
        (componentFunction as any).prototype &&
        (componentFunction as any).prototype.isReactComponent;

      if (isClassComponent) {
        // For class components - create fake constructor
        try {
          const FakeComponent = function () {
            throw new Error();
          };

          // Copy component name for better stack traces
          Object.defineProperty(FakeComponent.prototype.constructor, 'name', {
            value: componentFunction.name,
          });

          new (FakeComponent as any)();
        } catch (x) {
          control = x as Error;
        }
      } else {
        // For function components - call the function
        try {
          // First try - call with empty props
          (componentFunction as any)({});
        } catch (x) {
          control = x as Error;
        }

        // If that didn't throw, try calling without arguments
        if (!control) {
          try {
            (componentFunction as any)();
          } catch (x) {
            control = x as Error;
          }
        }
      }
    } catch (sample) {
      // Ignore any outer errors
    } finally {
      // Restore everything
      this.reentry = false;
      (Error as any).prepareStackTrace = previousPrepareStackTrace;
      try {
        this.restoreDispatcher(previousDispatcher);
      } catch (error) {
        console.warn('Failed to restore React dispatcher:', error);
      }
    }

    // Parse the captured stack trace
    let location = null;
    if (control && control.stack) {
      console.log(
        'Stack trace for',
        componentFunction.name,
        ':',
        control.stack
      );
      location = this.parseStackTrace(control.stack, componentFunction.name);
    } else {
      console.log('No stack trace generated for', componentFunction.name);
      console.log('Component function:', componentFunction);
      console.log('Control error:', control);

      // Try to extract location from JSX dev info
      location = this.extractLocationFromJSXDevInfo(componentFunction);
    }

    // Cache the result
    this.componentFrameCache.set(componentFunction, location);
    return location;
  }

  private getReactInternals(): any {
    const React = (window as any).React;
    if (!React) return null;

    // Try React 19 first
    if (React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE) {
      return React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    }

    // Fallback to React 18 and earlier
    if (React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
      return React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    }

    // Last resort - find internals by property sniffing
    const internals = Object.entries(React).find(
      ([key, value]) => value && (value as any).ReactCurrentOwner
    );

    return internals ? internals[1] : null;
  }

  private getMockDispatcher(): any {
    // Mock React's current dispatcher to prevent side effects
    const internals = this.getReactInternals();
    if (
      internals &&
      internals.ReactCurrentDispatcher &&
      internals.ReactCurrentDispatcher.current !== undefined
    ) {
      const previous = internals.ReactCurrentDispatcher.current;

      // Set empty dispatcher to prevent hooks from running
      internals.ReactCurrentDispatcher.current = {};

      return previous;
    }
    return null;
  }

  private restoreDispatcher(previousDispatcher: any): void {
    const internals = this.getReactInternals();
    if (
      internals &&
      internals.ReactCurrentDispatcher &&
      previousDispatcher !== undefined
    ) {
      internals.ReactCurrentDispatcher.current = previousDispatcher;
    }
  }

  private parseStackTrace(
    stack: string,
    componentName: string
  ): { file: string; line: number; column: number } | null {
    const lines = stack.split('\n');

    for (const line of lines) {
      // Look for the component name in the stack
      if (line.includes(componentName)) {
        // Parse different stack trace formats
        const patterns = [
          // Chrome: "at ComponentName (file:line:column)"
          /at\s+(\w+)\s+\((.+?):(\d+):(\d+)\)/,
          // Firefox: "ComponentName@file:line:column"
          /(\w+)@(.+?):(\d+):(\d+)/,
          // Safari: similar to Firefox
          /(\w+)@(.+?):(\d+):(\d+)/,
        ];

        for (const pattern of patterns) {
          const match = line.match(pattern);
          if (match && match[2] && match[3] && match[4]) {
            const [, name, file, lineStr, columnStr] = match;
            return {
              file,
              line: parseInt(lineStr, 10),
              column: parseInt(columnStr, 10),
            };
          }
        }
      }
    }

    return null;
  }

  private extractLocationFromJSXDevInfo(
    componentFunction: Function
  ): { file: string; line: number; column: number } | null {
    // Try to extract from React's internal dev info
    const devInfo = (componentFunction as any).__DEV__;
    if (devInfo && devInfo.fileName) {
      return {
        file: devInfo.fileName,
        line: devInfo.lineNumber || 1,
        column: devInfo.columnNumber || 1,
      };
    }

    return null;
  }
}

class DebugOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private animationId: number | null = null;
  private stackGenerator: SafeComponentStackGenerator;
  private debuggerWindow: Window | null = null;
  private debuggerWindowOrigin: string | null = null;
  private isHighlightingEnabled: boolean = false;
  private breakpoints: Array<{
    id: string;
    component: string;
    line: number;
    condition?: string;
    enabled: boolean;
    breakpointId?: string;
  }> = [];

  constructor() {
    this.stackGenerator = new SafeComponentStackGenerator();
    this.canvas = this.createCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    this.resizeCanvas();
    this.setupMouseTracking();
    this.createDebuggerWidget();
    this.startAnimation();

    // Listen for messages from the debugger window
    window.addEventListener('message', async (event) => {
      console.log('Parent received message:', event);
      if (
        !this.debuggerWindowOrigin ||
        event.origin !== this.debuggerWindowOrigin
      )
        return;
      const { type, payload, width, height } = event.data || {};

      if (type === 'toggleHighlighting') {
        this.isHighlightingEnabled =
          payload?.enabled ?? !this.isHighlightingEnabled;
      }

      if (type === 'updateBreakpoints') {
        this.breakpoints = payload?.breakpoints || [];
      }

      if (type === 'associateBreakpointWithComponent') {
        // Import the function from internals
        const { associateBreakpointWithComponent } = await import(
          './internals'
        );
        const success = associateBreakpointWithComponent(
          payload.breakpointNumber,
          payload.componentName
        );
        if (success) {
          console.log(
            `Successfully associated breakpoint ${payload.breakpointNumber} with component ${payload.componentName}`
          );
        }
      }

      if (type === 'removeBreakpointAssociation') {
        // Import the function from internals
        const { removeBreakpointAssociation } = await import('./internals');
        removeBreakpointAssociation(payload.breakpointNumber);
        console.log(
          `Removed breakpoint association for ${payload.breakpointNumber}`
        );
      }

      if (type === 'closeWidget') {
        this.hideWidget();
      }

      if (type === 'GET_COMPONENT_DATA') {
        console.log(
          '[Target] Received GET_COMPONENT_DATA for',
          payload.componentName
        );
        const { componentName, requestId } = payload;
        const componentData = this.getComponentDataByName(componentName);
        // Send response back to debugger
        if (this.debuggerWindow && !this.debuggerWindow.closed) {
          console.log(
            '[Target] Sending COMPONENT_DATA_RESPONSE',
            componentData
          );
          this.debuggerWindow.postMessage(
            {
              type: 'COMPONENT_DATA_RESPONSE',
              payload: componentData,
              requestId,
            },
            this.debuggerWindowOrigin
          );
        }
      }

      if (type === 'GET_BREAKPOINT_COMPONENT_DATA') {
        console.log(
          '[Target] Received GET_BREAKPOINT_COMPONENT_DATA for',
          payload.breakpointId
        );
        const { breakpointId, requestId } = payload;
        // Access the function through the global FiberDataBridge
        const rawComponentData = (
          window as any
        ).FiberDataBridge?.getComponentDataForBreakpoint(breakpointId);
        // Use the same serialization pattern for consistency
        const componentData = this.serializeFiberData(rawComponentData);
        // Send response back to debugger
        if (this.debuggerWindow && !this.debuggerWindow.closed) {
          console.log(
            '[Target] Sending BREAKPOINT_COMPONENT_DATA_RESPONSE',
            componentData
          );
          this.debuggerWindow.postMessage(
            {
              type: 'BREAKPOINT_COMPONENT_DATA_RESPONSE',
              payload: componentData,
              requestId,
            },
            this.debuggerWindowOrigin
          );
        }
      }

      if (type === 'GET_ALL_BREAKPOINT_COMPONENT_DATA') {
        console.log('[Target] Received GET_ALL_BREAKPOINT_COMPONENT_DATA');
        const { requestId } = payload;
        // Import the function from internals
        const { getAllBreakpointComponentData } = await import('./internals');
        const rawAllBreakpointData = getAllBreakpointComponentData();
        // Serialize all breakpoint data using the same pattern
        const allBreakpointData = Object.fromEntries(
          Object.entries(rawAllBreakpointData).map(([key, value]) => [
            key,
            this.serializeFiberData(value),
          ])
        );
        // Send response back to debugger
        if (this.debuggerWindow && !this.debuggerWindow.closed) {
          console.log(
            '[Target] Sending ALL_BREAKPOINT_COMPONENT_DATA_RESPONSE',
            allBreakpointData
          );
          this.debuggerWindow.postMessage(
            {
              type: 'ALL_BREAKPOINT_COMPONENT_DATA_RESPONSE',
              payload: allBreakpointData,
              requestId,
            },
            this.debuggerWindowOrigin
          );
        }
      }
    });
  }

  private createDebuggerWidget() {
    if (typeof window === 'undefined') return;

    // Open debugger in a new window. If the browser blocks popups (common
    // when opening outside a user gesture), fall back to rendering a small
    // in-page toggle button which the user can click to open the debugger
    // (user gesture -> not blocked).
    const debuggerUrl = 'http://127.0.0.1:5679/debugger';
    const windowFeatures =
      'width=720,height=600,resizable=yes,scrollbars=yes,status=no,location=no,toolbar=no,menubar=no';

    // Try to open immediately (may be blocked)
    this.debuggerWindow = window.open(
      debuggerUrl,
      'react-debugger',
      windowFeatures
    );
    this.debuggerWindowOrigin = new URL(debuggerUrl).origin;

    if (!this.debuggerWindow) {
      // Popup blocked. Create a persistent small toggle button so the user
      // can open the debugger via a click (user gesture).
      console.warn('Debugger popup blocked — showing in-page toggle button.');

      // Only create the button once
      if (!document.getElementById('react-debugger-widget')) {
        const btn = document.createElement('button');
        btn.id = 'react-debugger-widget';
        btn.title = 'Open React Debugger';
        btn.innerText = '🐞';
        btn.style.cssText = `
          position: fixed;
          right: 12px;
          bottom: 12px;
          width: 48px;
          height: 48px;
          border-radius: 24px;
          background: #111;
          color: #fff;
          border: 1px solid rgba(255,255,255,0.06);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 20px;
        `;

        btn.addEventListener('click', () => {
          // Attempt to open again on user gesture
          this.debuggerWindow = window.open(
            debuggerUrl,
            'react-debugger',
            windowFeatures
          );
          if (this.debuggerWindow) {
            // Remove button once opened
            try {
              btn.remove();
            } catch {}
            this.debuggerWindowOrigin = new URL(debuggerUrl).origin;
          } else {
            console.warn('Failed to open debugger window from user gesture.');
          }
        });

        document.body.appendChild(btn);
      }
    }

    // Listen for messages from the debugger window
    window.addEventListener('message', (event) => {
      if (event.source !== this.debuggerWindow) return;

      const { type, payload } = event.data;

      if (type === 'TOGGLE_DEBUGGER') {
        // Handle debugger toggle request from debugger window
        this.toggleDebugger();
      } else if (type === 'UPDATE_BREAKPOINTS') {
        // Update breakpoints from debugger window
        this.breakpoints = payload.breakpoints || [];
      } else if (type === 'TOGGLE_HIGHLIGHTING') {
        // Toggle highlighting mode
        this.isHighlightingEnabled = payload.enabled;
      }
    });

    // Handle window close
    const checkWindowClosed = setInterval(() => {
      if (this.debuggerWindow?.closed) {
        clearInterval(checkWindowClosed);
        this.debuggerWindow = null;
        this.debuggerWindowOrigin = null;
      }
    }, 1000);
  }

  private hideWidget() {
    if (this.debuggerWindow && !this.debuggerWindow.closed) {
      this.debuggerWindow.close();
      this.debuggerWindow = null;
      this.debuggerWindowOrigin = null;
    }
  }

  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = 'react-debugger-canvas';
    canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 999998;
    `;
    document.body.appendChild(canvas);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resizeCanvas());
    }

    return canvas;
  }

  private isDebuggerElement(element: HTMLElement): boolean {
    // Check if the element is part of the debugger UI
    let currentElement: HTMLElement | null = element;
    while (currentElement) {
      if (currentElement.id === 'react-debugger-widget') {
        return true;
      }
      currentElement = currentElement.parentElement;
    }
    return false;
  }

  private resizeCanvas() {
    if (typeof window === 'undefined') return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  private setupMouseTracking() {
    if (typeof document === 'undefined') return;

    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    document.addEventListener('click', (e) => {
      this.handleComponentClick(e);
    });

    // Add keyboard shortcut to toggle debugger (Ctrl+Shift+D)
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.toggleDebugger();
      }
    });
  }

  private toggleDebugger() {
    if (this.debuggerWindow && !this.debuggerWindow.closed) {
      // If window exists, close it
      this.debuggerWindow.close();
      this.debuggerWindow = null;
      this.debuggerWindowOrigin = null;
    } else {
      // If window doesn't exist, create it
      this.createDebuggerWidget();
    }
  }

  private handleComponentClick(e: MouseEvent) {
    if (!this.isHighlightingEnabled) return;

    const clickedElement = e.target as HTMLElement;
    console.log('clickedElement', clickedElement);
    if (!clickedElement) return;

    // Ignore debugger UI elements
    if (this.isDebuggerElement(clickedElement)) return;

    // Find the component that rendered this element
    const componentInfo = this.getComponentForElement(clickedElement);
    if (componentInfo) {
      const { type, name, fiberData } = componentInfo;
      console.log('Component type:', type);
      console.log('Component name:', name);
      console.log('Fiber data:', fiberData);

      // Get source location
      const location = this.stackGenerator.getComponentSourceLocation(type);
      if (location) {
        console.log('Source location:', location);

        // Send component selection to iframe
        this.sendComponentSelectionToWidget({
          componentName: name,
          componentType: type,
          sourceLocation: location,
          boundingRect: componentInfo.rect,
          fiberData: fiberData, // Pass the real fiber data
        });
      }
    }
  }

  private serializeFiberData(fiberData: any): any {
    if (!fiberData) return null;

    try {
      return {
        // Hooks have a circular reference - serialize safely
        hooks:
          fiberData.hooks?.map((hook: any, index: number) => ({
            hookType: hook.hookType,
            index: hook.index,
            value: typeof hook.value === 'object' ? '[Object]' : hook.value,
            deps:
              hook.hookType === 'useEffect'
                ? JSON.stringify(hook.value.deps)
                : null,
            // Don't include 'next', 'queue', or other complex properties
          })) || [],
        // State can be serialized directly
        state: JSON.parse(JSON.stringify(fiberData.state || {})),
        // Context can contain functions - serialize safely
        context: fiberData.context
          ? JSON.parse(JSON.stringify(fiberData.context))
          : {},
        // Props might contain event handlers (functions) - serialize safely
        props: fiberData.props
          ? JSON.parse(JSON.stringify(fiberData.props))
          : {},
        // Simple values can be passed directly
        renderCount: fiberData.renderCount || 0,
        lastRenderTime: fiberData.lastRenderTime || Date.now(),
      };
    } catch (error) {
      console.error('Error serializing fiber data:', error);
      return {
        hooks: [],
        state: {},
        context: {},
        props: {},
        renderCount: 0,
        lastRenderTime: Date.now(),
        error: 'Failed to serialize fiber data',
      };
    }
  }

  private sendComponentSelectionToWidget(componentInfo: {
    componentName: string;
    componentType: Function;
    sourceLocation: { file: string; line: number; column: number };
    boundingRect: DOMRect;
    fiberData?: any;
  }) {
    if (
      this.debuggerWindow &&
      !this.debuggerWindow.closed &&
      this.debuggerWindowOrigin
    ) {
      console.log('componentInfo: ', componentInfo);
      console.log('fiberData: ', componentInfo.fiberData);

      try {
        const payload = {
          name: componentInfo.componentName,
          sourceLocation: JSON.parse(
            JSON.stringify(componentInfo.sourceLocation)
          ),
          boundingRect: {
            x: componentInfo.boundingRect.x,
            y: componentInfo.boundingRect.y,
            width: componentInfo.boundingRect.width,
            height: componentInfo.boundingRect.height,
          },
          fiberData: this.serializeFiberData(componentInfo.fiberData),
        };

        this.debuggerWindow.postMessage(
          {
            type: 'SELECT_COMPONENT',
            payload,
          },
          this.debuggerWindowOrigin
        );
      } catch (err) {
        console.error('postMessage error:', err);
      }
    }
  }

  private startAnimation() {
    const animate = () => {
      this.draw();
      this.animationId = requestAnimationFrame(animate);
    };
    animate();
  }

  private draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Always draw breakpoint highlights (persistent)
    this.drawBreakpointHighlights();

    // Draw hover highlights only when enabled
    if (this.isHighlightingEnabled) {
      this.drawFiberHighlights();
    }
  }

  private drawFiberHighlights() {
    if (typeof document === 'undefined') return;

    const hoveredElement = document.elementFromPoint(
      this.mouseX,
      this.mouseY
    ) as HTMLElement;

    if (!hoveredElement) return;

    // Ignore debugger UI elements
    if (this.isDebuggerElement(hoveredElement)) return;

    // Find the component that rendered this element
    const componentInfo = this.getComponentForElement(hoveredElement);
    if (componentInfo) {
      // Check if this component has a breakpoint
      const hasBreakpoint = this.breakpoints.some(
        (bp) => bp.component === componentInfo.name && bp.enabled
      );

      if (hasBreakpoint) {
        // Draw solid border for components with breakpoints (always visible)
        this.drawBreakpointHighlight(
          componentInfo.rect,
          componentInfo.name,
          true
        );
      } else if (this.isHighlightingEnabled) {
        // Draw normal highlight only when highlighting is enabled
        this.drawNormalHighlight(componentInfo.rect, componentInfo.name);
      }
    }
  }

  private getComponentForElement(
    element: HTMLElement
  ): { rect: DOMRect; name: string; type: Function; fiberData?: any } | null {
    // Look up the element in your existing HTMLMap
    const fiber = getFiberFromElement(element);
    if (!fiber) return null;

    // Walk UP the fiber tree to find the nearest component
    let currentFiber: FiberNode | null = fiber;
    while (currentFiber) {
      if (typeof currentFiber.type === 'function') {
        // Found a component! Now get its bounding rect and fiber data
        const rect = this.getComponentBoundingRect(currentFiber);
        const name = currentFiber.type.name || '(anonymous)';

        // Extract real fiber data
        const fiberData = this.extractFiberData(currentFiber);

        return { rect, name, type: currentFiber.type, fiberData };
      }
      currentFiber = currentFiber.return; // Go up to parent
    }

    return null;
  }

  private extractFiberData(fiber: FiberNode) {
    if (!fiber) return null;

    // Extract props
    const props = fiber.memoizedProps || {};

    // Extract state (for function components)
    const state = this.extractStateFromFiber(fiber);

    // Extract hooks
    const hooks = this.extractHooksFromFiber(fiber);

    // Extract context
    const context = this.extractContextFromFiber(fiber);

    return {
      props,
      state,
      context,
      hooks,
      renderCount: 0, // Could be derived from fiber.actualDuration
      lastRenderTime: Date.now(),
    };
  }

  private extractStateFromFiber(fiber: FiberNode): Record<string, any> {
    const state: Record<string, any> = {};

    if (fiber.memoizedState) {
      // For function components, state is in memoizedState
      if (typeof fiber.memoizedState === 'object') {
        // Handle different types of state
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

  private extractHooksFromFiber(
    fiber: FiberNode
  ): Array<{ type: string; value: any; index: number; hookType?: string }> {
    const hooks: Array<{
      type: string;
      value: any;
      index: number;
      hookType?: string;
    }> = [];

    if (!fiber.memoizedState) return hooks;

    let currentHook = fiber.memoizedState;
    let hookIndex = 0;

    while (currentHook) {
      const hookType = this.getHookType(currentHook);
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

  private getHookType(hook: any): string {
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

  private extractContextFromFiber(fiber: FiberNode): Record<string, any> {
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

  private getComponentDataByName(componentName: string) {
    // Find the breakpoint for this component and get its data
    const breakpoint = this.breakpoints.find(
      (bp) => bp.component === componentName
    );
    if (
      breakpoint &&
      typeof window !== 'undefined' &&
      (window as any).FiberDataBridge
    ) {
      const rawData = (
        window as any
      ).FiberDataBridge.getComponentDataForBreakpoint(breakpoint.id);
      // Use the same serialization pattern for consistency
      return this.serializeFiberData(rawData);
    }
    return null;
  }

  private findFiberByName(
    rootFiber: FiberNode,
    componentName: string
  ): FiberNode | null {
    const fibers: FiberNode[] = [];

    function traverse(fiber: FiberNode | null) {
      if (!fiber) return;
      fibers.push(fiber);
      if (fiber.child) traverse(fiber.child);
      if (fiber.sibling) traverse(fiber.sibling);
    }

    traverse(rootFiber);
    return (
      fibers.find((fiber) => {
        if (typeof fiber.type === 'function') {
          return fiber.type.name === componentName;
        }
        return false;
      }) || null
    );
  }

  private getComponentBoundingRect(componentFiber: FiberNode): DOMRect {
    // Find all DOM elements this component rendered
    const elements: HTMLElement[] = [];

    const collectElements = (fiber: FiberNode | null) => {
      if (!fiber) return;

      // Stop if we hit another component (don't include nested components)
      if (typeof fiber.type === 'function' && fiber !== componentFiber) {
        return;
      }

      if (fiber.stateNode instanceof HTMLElement) {
        elements.push(fiber.stateNode);
      }

      // Recursively check children
      let child = fiber.child;
      while (child) {
        collectElements(child);
        child = child.sibling;
      }
    };

    collectElements(componentFiber);

    if (elements.length === 0) {
      return new DOMRect(0, 0, 0, 0);
    }

    // Calculate bounding rect from all elements
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      minX = Math.min(minX, rect.left);
      minY = Math.min(minY, rect.top);
      maxX = Math.max(maxX, rect.right);
      maxY = Math.max(maxY, rect.bottom);
    }

    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  private drawNormalHighlight(rect: DOMRect, componentName: string) {
    // Draw semi-transparent background
    this.ctx.fillStyle = 'rgba(78, 205, 196, 0.08)';
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    // Draw solid border with more opacity
    this.ctx.strokeStyle = 'rgba(78, 205, 196, 0.6)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([]); // Solid line
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    // Draw tooltip
    this.drawTooltip(rect, componentName, 'Click to set breakpoint');
  }

  private drawBreakpointHighlight(
    rect: DOMRect,
    componentName: string,
    showTooltip: boolean = false
  ) {
    // Draw solid turquoise border for components with breakpoints
    this.ctx.strokeStyle = 'rgb(78, 205, 196)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]); // Solid line
    this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    // Draw tooltip only if requested
    if (showTooltip) {
      this.drawTooltip(rect, componentName, 'Breakpoint set');
    }
  }

  private drawBreakpointHighlights() {
    if (typeof document === 'undefined') return;

    // Find all React components in the DOM
    const allElements = Array.from(document.querySelectorAll('*'));

    for (const element of allElements) {
      if (element instanceof HTMLElement) {
        // Ignore debugger UI elements
        if (this.isDebuggerElement(element)) continue;

        // Find the component that rendered this element
        const componentInfo = this.getComponentForElement(element);
        if (componentInfo) {
          // Check if this component has a breakpoint
          const hasBreakpoint = this.breakpoints.some(
            (bp) => bp.component === componentInfo.name && bp.enabled
          );

          if (hasBreakpoint) {
            // Draw solid border for components with breakpoints (always visible, no tooltip)
            this.drawBreakpointHighlight(
              componentInfo.rect,
              componentInfo.name,
              false
            );
          }
        }
      }
    }
  }

  private drawTooltip(rect: DOMRect, componentName: string, typeInfo: string) {
    const tooltipText = `${componentName}`;
    const tooltipSubtext = typeInfo;

    // Calculate tooltip position
    const tooltipX = rect.x + rect.width / 2;
    const tooltipY = rect.y - 10;
    const padding = 8;
    const lineHeight = 16;

    // Measure text
    this.ctx.font = '12px monospace';
    const mainTextWidth = this.ctx.measureText(tooltipText).width;
    this.ctx.font = '10px monospace';
    const subTextWidth = this.ctx.measureText(tooltipSubtext).width;
    const tooltipWidth = Math.max(mainTextWidth, subTextWidth) + padding * 2;
    const tooltipHeight = lineHeight * 2 + padding * 2;

    // Position tooltip above the component
    let finalX = tooltipX - tooltipWidth / 2;
    let finalY = tooltipY - tooltipHeight;

    // Keep tooltip within viewport
    if (finalX < 10) finalX = 10;
    if (finalX + tooltipWidth > window.innerWidth - 10) {
      finalX = window.innerWidth - tooltipWidth - 10;
    }
    if (finalY < 10) {
      finalY = rect.y + rect.height + 10;
    }

    // Draw background
    this.ctx.fillStyle = 'rgba(15, 20, 25, 0.95)';
    this.ctx.fillRect(finalX, finalY, tooltipWidth, tooltipHeight);

    // Draw border
    this.ctx.strokeStyle = 'rgba(78, 205, 196, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(finalX, finalY, tooltipWidth, tooltipHeight);

    // Draw main text
    this.ctx.fillStyle = 'rgb(255, 255, 255)';
    this.ctx.font = '12px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      tooltipText,
      finalX + tooltipWidth / 2,
      finalY + padding + 12
    );

    // Draw subtext
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.font = '10px monospace';
    this.ctx.fillText(
      tooltipSubtext,
      finalX + tooltipWidth / 2,
      finalY + padding + lineHeight + 10
    );

    // Reset text alignment
    this.ctx.textAlign = 'left';
  }
}

// Initialize the debugger overlay
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.__reactDebuggerOverlay = new DebugOverlay();
    });
  } else {
    // DOM is already ready
    window.__reactDebuggerOverlay = new DebugOverlay();
  }
}

declare global {
  interface Window {
    __reactDebuggerOverlay?: DebugOverlay;
  }
}
