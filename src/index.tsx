// src/index.tsx
// React Debugger: High-performance canvas overlay + React UI

import {
  getFiberRects,
  getFiberFromElement,
  type FiberNode,
} from './internals';
import React from 'react';
import { createRoot } from 'react-dom/client';

export interface DebuggerOptions {
  port?: number;
  overlay?: boolean;
  console?: boolean;
  network?: boolean;
  performance?: boolean;
}

export interface CDPMessage {
  id?: number;
  method: string;
  params: any;
}

export interface CDPTarget {
  type: string;
  webSocketDebuggerUrl: string;
}

const WS_URL = 'ws://localhost:5678';

interface DebuggerState {
  isOpen: boolean;
  sections: {
    logs: boolean;
    breakpoints: boolean;
    components: boolean;
  };
  logs: Array<{
    type: 'info' | 'warn' | 'error';
    message: string;
    timestamp: number;
  }>;
  breakpoints: Array<{
    id: string;
    component: string;
    line: number;
    file: string;
    componentType: Function;
  }>;
  isHighlighting: boolean;
  isPaused: boolean;
}

// React Debugger Overlay Component
const DebuggerOverlayComponent: React.FC<{
  state: DebuggerState;
  onStateChange: (newState: DebuggerState) => void;
}> = ({ state, onStateChange }) => {
  const toggleSection = (section: keyof typeof state.sections) => {
    onStateChange({
      ...state,
      sections: {
        ...state.sections,
        [section]: !state.sections[section],
      },
    });
  };

  const toggleHighlighting = () => {
    const newHighlighting = !state.isHighlighting;
    onStateChange({
      ...state,
      isHighlighting: newHighlighting,
      logs: [
        ...state.logs,
        {
          type: 'info',
          message: `Component highlighting ${
            newHighlighting ? 'enabled' : 'disabled'
          }`,
          timestamp: Date.now(),
        },
      ],
    });
  };

  const clearLogs = () => {
    onStateChange({ ...state, logs: [] });
  };

  const clearBreakpoints = () => {
    onStateChange({ ...state, breakpoints: [] });
  };

  if (!state.isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '400px',
        maxHeight: '500px',
        background: 'rgba(0, 0, 0, 0.9)',
        color: 'rgb(255, 255, 255)',
        fontFamily: 'monospace',
        fontSize: '12px',
        borderRadius: '8px',
        padding: '12px',
        zIndex: 999999,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: 'rgba(0, 0, 0, 0.3) 0px 4px 12px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          paddingBottom: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
          React Debugger
        </span>
        <button
          onClick={() => onStateChange({ ...state, isOpen: false })}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgb(255, 255, 255)',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '0px',
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '10px',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={toggleHighlighting}
          style={{
            background: state.isHighlighting
              ? 'rgba(78, 205, 196, 0.2)'
              : 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: state.isHighlighting
              ? 'rgb(78, 205, 196)'
              : 'rgb(255, 255, 255)',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          {state.isHighlighting ? '● HIGHLIGHT' : '○ HIGHLIGHT'}
        </button>

        <button
          onClick={() => toggleSection('logs')}
          style={{
            background: state.sections.logs
              ? 'rgba(255, 255, 255, 0.1)'
              : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'rgb(255, 255, 255)',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          LOGS {state.sections.logs ? '▼' : '▶'}
        </button>

        <button
          onClick={() => toggleSection('breakpoints')}
          style={{
            background: state.sections.breakpoints
              ? 'rgba(255, 255, 255, 0.1)'
              : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'rgb(255, 255, 255)',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          BREAKPOINTS ({state.breakpoints.length}){' '}
          {state.sections.breakpoints ? '▼' : '▶'}
        </button>

        <button
          onClick={() => toggleSection('components')}
          style={{
            background: state.sections.components
              ? 'rgba(255, 255, 255, 0.1)'
              : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: 'rgb(255, 255, 255)',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          COMPONENTS {state.sections.components ? '▼' : '▶'}
        </button>
      </div>

      {/* Sticky Logs Header */}
      {state.sections.logs && (
        <div
          style={{
            position: 'sticky',
            top: '0',
            background: 'rgba(0, 0, 0, 0.9)',
            padding: '8px 0',
            marginBottom: '8px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span
              style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)' }}
            >
              LOGS ({state.logs.length})
            </span>
            <button
              onClick={clearLogs}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '10px',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              CLEAR
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: '1 1 0%', overflowY: 'auto', maxHeight: '350px' }}>
        {/* Logs Section */}
        {state.sections.logs && (
          <div style={{ marginBottom: '12px' }}>
            {state.logs.map((log, i) => (
              <div
                key={i}
                style={{
                  marginBottom: '4px',
                  padding: '2px 0px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <span
                  style={{
                    color:
                      log.type === 'info'
                        ? 'rgb(78, 205, 196)'
                        : log.type === 'warn'
                        ? 'rgb(255, 193, 7)'
                        : 'rgb(220, 53, 69)',
                    fontWeight: 'bold',
                    marginRight: '8px',
                    fontSize: '10px',
                  }}
                >
                  {log.type.toUpperCase()}
                </span>
                <span style={{ wordBreak: 'break-word' }}>{log.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Breakpoints Section */}
        {state.sections.breakpoints && (
          <div style={{ marginBottom: '12px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
              }}
            >
              <span
                style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)' }}
              >
                BREAKPOINTS ({state.breakpoints.length})
              </span>
              <button
                onClick={clearBreakpoints}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                }}
              >
                CLEAR
              </button>
            </div>
            {state.breakpoints.map((bp) => (
              <div
                key={bp.id}
                style={{
                  marginBottom: '4px',
                  padding: '4px 6px',
                  background: 'rgba(220, 53, 69, 0.1)',
                  border: '1px solid rgba(220, 53, 69, 0.3)',
                  borderRadius: '4px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 'bold' }}>
                  {bp.component}:{bp.line}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Components Section */}
        {state.sections.components && (
          <div style={{ marginBottom: '12px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
              }}
            >
              <span
                style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)' }}
              >
                COMPONENT TREE
              </span>
            </div>
            <div style={{ fontSize: '11px', lineHeight: '1.4' }}>
              <div style={{ paddingLeft: '0px' }}>▼ App</div>
              <div style={{ paddingLeft: '12px' }}>▼ Header</div>
              <div style={{ paddingLeft: '24px' }}>○ Logo</div>
              <div style={{ paddingLeft: '24px' }}>○ Navigation</div>
              <div style={{ paddingLeft: '12px' }}>▼ Main</div>
              <div style={{ paddingLeft: '24px' }}>○ UserProfile</div>
              <div style={{ paddingLeft: '24px' }}>○ LoginForm</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

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
    const previousDispatcher = this.getMockDispatcher();

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
      this.restoreDispatcher(previousDispatcher);
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
    if (internals && internals.ReactCurrentDispatcher) {
      const previous = internals.ReactCurrentDispatcher.current;

      // Set empty dispatcher to prevent hooks from running
      internals.ReactCurrentDispatcher.current = {};

      return previous;
    }
    return null;
  }

  private restoreDispatcher(previousDispatcher: any): void {
    const internals = this.getReactInternals();
    if (internals && internals.ReactCurrentDispatcher && previousDispatcher) {
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
            return {
              file: match[2],
              line: parseInt(match[3]),
              column: parseInt(match[4]),
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
    try {
      // Call the component to get the JSX dev info
      const result = (componentFunction as any)();

      // Look for JSX dev info in the result
      if (result && typeof result === 'object' && result._source) {
        return {
          file: result._source.fileName,
          line: result._source.lineNumber,
          column: result._source.columnNumber || 0,
        };
      }

      // If that doesn't work, try to extract from the function's toString
      const funcStr = componentFunction.toString();
      console.log('Function string:', funcStr);

      // Look for fileName and lineNumber in the function string
      const fileNameMatch = funcStr.match(/fileName:\s*"([^"]+)"/);
      const lineNumberMatch = funcStr.match(/lineNumber:\s*(\d+)/);

      if (
        fileNameMatch &&
        lineNumberMatch &&
        fileNameMatch[1] &&
        lineNumberMatch[1]
      ) {
        return {
          file: fileNameMatch[1],
          line: parseInt(lineNumberMatch[1]),
          column: 0,
        };
      }
    } catch (error) {
      console.log('Error extracting JSX dev info:', error);
    }

    return null;
  }
}

class DebugOverlay {
  private ws!: WebSocket;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private animationId: number | null = null;
  private debuggerRoot: any = null;
  private stackGenerator: SafeComponentStackGenerator;
  private activeBreakpoints: Map<
    Function,
    { file: string; line: number; breakpointId?: string }
  > = new Map();

  private debuggerState: DebuggerState = {
    isOpen: true,
    sections: {
      logs: true,
      breakpoints: false,
      components: false,
    },
    logs: [
      {
        type: 'info',
        message: 'Connected to debug server',
        timestamp: Date.now(),
      },
      { type: 'info', message: 'Overlay connected!', timestamp: Date.now() },
    ],
    breakpoints: [],
    isHighlighting: true,
    isPaused: false,
  };

  constructor() {
    this.stackGenerator = new SafeComponentStackGenerator();
    this.canvas = this.createCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    this.resizeCanvas();
    this.setupMouseTracking();
    this.setupWebSocket();
    this.createDebuggerWidget();
    this.startAnimation();
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

  private createDebuggerWidget() {
    if (typeof document === 'undefined') return;

    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'react-debugger-widget';
    document.body.appendChild(widgetContainer);

    this.debuggerRoot = createRoot(widgetContainer);
    this.updateDebuggerWidget();
  }

  private updateDebuggerWidget() {
    if (this.debuggerRoot) {
      this.debuggerRoot.render(
        <DebuggerOverlayComponent
          state={this.debuggerState}
          onStateChange={(newState) => {
            // If breakpoints were cleared, also clear the activeBreakpoints map
            if (
              newState.breakpoints.length === 0 &&
              this.debuggerState.breakpoints.length > 0
            ) {
              this.activeBreakpoints.clear();
            }

            this.debuggerState = newState;
            this.updateDebuggerWidget();
            // Update highlighting state
            if (
              this.debuggerState.isHighlighting !== this.isHighlightingEnabled()
            ) {
              // The highlighting state changed, we'll handle this in the draw loop
            }
          }}
        />
      );
    }
  }

  private isHighlightingEnabled(): boolean {
    return this.debuggerState.isHighlighting;
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

    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  private setupMouseTracking() {
    if (typeof document === 'undefined') return;

    let lastMove = 0;
    const throttleMs = 16; // ~60fps

    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMove < throttleMs) return;
      lastMove = now;

      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    document.addEventListener('click', (e) => {
      console.log('clicked');
      // Check if we clicked on a component
      this.handleComponentClick(e);
    });
  }

  private handleComponentClick(e: MouseEvent) {
    if (!this.isHighlightingEnabled()) return;

    const clickedElement = e.target as HTMLElement;
    console.log('clickedElement', clickedElement);
    if (!clickedElement) return;

    // Ignore debugger UI elements
    if (this.isDebuggerElement(clickedElement)) return;

    // Find the component that rendered this element
    const componentInfo = this.getComponentForElement(clickedElement);
    if (componentInfo) {
      const { type, name } = componentInfo;
      console.log('Component type:', type);
      console.log('Component name:', name);

      // Check if component already has a breakpoint
      const existingBreakpoint = this.activeBreakpoints.get(type);

      if (existingBreakpoint) {
        // Remove breakpoint
        this.removeCDPBreakpoint(type, existingBreakpoint);
      } else {
        // Add breakpoint
        const location = this.stackGenerator.getComponentSourceLocation(type);
        if (location) {
          console.log('Source location:', location);
          this.addLog(
            'info',
            `Found source for ${name}: ${location.file}:${location.line}:${location.column}`
          );

          // Set breakpoint via CDP
          this.setCDPBreakpoint(location.file, location.line, type);
        } else {
          this.addLog(
            'warn',
            `Could not determine source location for ${name}`
          );
        }
      }
    }
  }

  private setCDPBreakpoint(
    file: string,
    line: number,
    componentType: Function
  ) {
    if (this.ws.readyState === WebSocket.OPEN) {
      const message: CDPMessage = {
        id: Date.now(), // Add an ID to track the response
        method: 'Debugger.setBreakpointByUrl',
        params: {
          lineNumber: line - 1, // CDP uses 0-based line numbers
          url: file,
          columnNumber: 0,
        },
      };

      this.ws.send(JSON.stringify(message));
      this.addLog('info', `Set breakpoint at ${file}:${line}`);

      // Store breakpoint info without ID initially
      this.activeBreakpoints.set(componentType, { file, line });

      // Update debugger state
      this.debuggerState.breakpoints.push({
        id: Date.now().toString(),
        component: componentType.name || '(anonymous)',
        line,
        file,
        componentType, // Store the actual function reference
      });

      // Update the debugger widget to reflect the new breakpoint
      this.updateDebuggerWidget();
    } else {
      this.addLog('warn', 'WebSocket not connected, cannot set breakpoint');
    }
  }

  private removeCDPBreakpoint(
    componentType: Function,
    breakpointInfo: { file: string; line: number; breakpointId?: string }
  ) {
    if (this.ws.readyState === WebSocket.OPEN) {
      if (breakpointInfo.breakpointId) {
        // Remove breakpoint using CDP if we have the ID
        const message: CDPMessage = {
          method: 'Debugger.removeBreakpoint',
          params: {
            breakpointId: breakpointInfo.breakpointId,
          },
        };
        this.ws.send(JSON.stringify(message));
        this.addLog(
          'info',
          `Removed breakpoint with ID: ${breakpointInfo.breakpointId}`
        );
      } else {
        // Fallback: just log that we're removing it locally
        this.addLog(
          'info',
          `Removed breakpoint at ${breakpointInfo.file}:${breakpointInfo.line} (local only)`
        );
      }
    } else {
      this.addLog('warn', 'WebSocket not connected, cannot remove breakpoint');
    }

    // Remove from active breakpoints map
    this.activeBreakpoints.delete(componentType);

    // Remove from debugger state
    this.debuggerState.breakpoints = this.debuggerState.breakpoints.filter(
      (bp) => bp.componentType !== componentType
    );

    // Update the debugger widget to reflect the removed breakpoint
    this.updateDebuggerWidget();
  }

  private setupWebSocket() {
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => this.addLog('info', 'Connected to debug server');
    this.ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws.onclose = () => {
      this.addLog('warn', 'WebSocket connection closed. Reconnecting in 2s...');
      setTimeout(() => this.setupWebSocket(), 2000);
    };
    this.ws.onerror = () => this.addLog('error', 'WebSocket error');
  }

  private addLog(type: 'info' | 'warn' | 'error', message: string) {
    this.debuggerState.logs.push({ type, message, timestamp: Date.now() });
    if (this.debuggerState.logs.length > 50) {
      this.debuggerState.logs.shift();
    }
    this.updateDebuggerWidget();
  }

  private handleMessage(data: string) {
    try {
      const msg = JSON.parse(data);

      // Handle CDP responses for breakpoint creation
      if (msg.id && msg.result && msg.result.breakpointId) {
        // Find the component that corresponds to this breakpoint ID
        // We'll need to match it based on the request ID or other criteria
        // For now, we'll just log the breakpoint ID
        this.addLog(
          'info',
          `Breakpoint created with ID: ${msg.result.breakpointId}`
        );
      }

      // Handle other messages
      if (msg.type && msg.log) {
        this.addLog(msg.type, msg.log);
      }
    } catch {}
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
    this.drawBreakpointHighlights();
    this.drawFiberHighlights();
  }

  private drawBreakpointHighlights() {
    if (typeof document === 'undefined' || !this.isHighlightingEnabled())
      return;

    // Draw red borders for all components with breakpoints
    for (const [componentType, breakpointInfo] of this.activeBreakpoints) {
      // Find the component fiber and get its bounding rect using the same approach as hover highlighting
      const componentFiber = this.findComponentFiber(componentType);

      if (componentFiber) {
        const rect = this.getComponentBoundingRect(componentFiber);
        const componentName = componentType.name || '(anonymous)';

        // Draw the breakpoint highlight (red border)
        this.drawBreakpointHighlight(rect, componentName);
      }
    }
  }

  private findComponentFiber(componentType: Function): FiberNode | null {
    // Get all fiber rects and find the component fiber
    const fiberRects = getFiberRects();

    for (const { fiberNode } of fiberRects) {
      // Walk up the fiber tree to find the component
      let currentFiber: FiberNode | null = fiberNode;
      while (currentFiber) {
        if (
          typeof currentFiber.type === 'function' &&
          currentFiber.type === componentType
        ) {
          return currentFiber;
        }
        currentFiber = currentFiber.return;
      }
    }

    return null;
  }

  private drawFiberHighlights() {
    if (typeof document === 'undefined' || !this.isHighlightingEnabled())
      return;

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
      const hasBreakpoint = this.activeBreakpoints.has(componentInfo.type);

      // Only draw hover highlights for components without breakpoints
      // Components with breakpoints are already drawn by drawBreakpointHighlights()
      if (!hasBreakpoint) {
        this.drawNormalHighlight(componentInfo.rect, componentInfo.name);
      }
    }
  }

  private getComponentForElement(
    element: HTMLElement
  ): { rect: DOMRect; name: string; type: Function } | null {
    // Look up the element in your existing HTMLMap
    const fiber = getFiberFromElement(element);
    if (!fiber) return null;

    // Walk UP the fiber tree to find the nearest component
    let currentFiber: FiberNode | null = fiber;
    while (currentFiber) {
      if (typeof currentFiber.type === 'function') {
        // Found a component! Now get its bounding rect
        const rect = this.getComponentBoundingRect(currentFiber);
        const name = currentFiber.type.name || '(anonymous)';
        return { rect, name, type: currentFiber.type };
      }
      currentFiber = currentFiber.return; // Go up to parent
    }

    return null;
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

      if (fiber.child) collectElements(fiber.child);
      if (fiber.sibling) collectElements(fiber.sibling);
    };

    collectElements(componentFiber.child || null);

    // Calculate bounding rect that encompasses all elements
    if (elements.length === 0) return new DOMRect();

    const rects = elements.map((el) => el.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));

    return new DOMRect(left, top, right - left, bottom - top);
  }

  private drawComponentHighlight(
    rect: DOMRect,
    componentName: string,
    hasBreakpoint = false
  ) {
    if (hasBreakpoint) {
      this.drawBreakpointHighlight(rect, componentName);
    } else {
      this.drawNormalHighlight(rect, componentName);
    }
  }

  private drawBreakpointHighlight(rect: DOMRect, componentName: string) {
    const radius = 6;
    const x = rect.left - 2;
    const y = rect.top - 2;
    const width = rect.width + 4;
    const height = rect.height + 4;

    // Draw red background with rounded corners (matching your existing style)
    this.ctx.fillStyle = 'rgba(220, 53, 69, 0.1)';
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(
      x + width,
      y + height,
      x + width - radius,
      y + height
    );
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
    this.ctx.fill();

    // Draw red border with rounded corners
    this.ctx.strokeStyle = 'rgb(220, 53, 69)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]); // Solid line
    this.ctx.stroke();

    // Draw red circle at top-right
    const circleX = rect.right - 6;
    const circleY = rect.top + 6;
    this.ctx.fillStyle = 'rgb(220, 53, 69)';
    this.ctx.beginPath();
    this.ctx.arc(circleX, circleY, 4, 0, 2 * Math.PI);
    this.ctx.fill();

    // Draw tooltip with breakpoint indication
    this.drawTooltip(rect, componentName, 'Component (Breakpoint)');
  }
  private drawNormalHighlight(rect: DOMRect, componentName: string) {
    const radius = 6;
    const x = rect.left - 2;
    const y = rect.top - 2;
    const width = rect.width + 4;
    const height = rect.height + 4;

    // Draw light teal background with rounded corners
    this.ctx.fillStyle = 'rgba(78, 205, 196, 0.1)';
    this.ctx.beginPath();
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(
      x + width,
      y + height,
      x + width - radius,
      y + height
    );
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
    this.ctx.fill();

    // Draw solid teal border with rounded corners
    this.ctx.strokeStyle = 'rgb(78, 205, 196)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([]); // Solid line
    this.ctx.stroke();

    this.drawTooltip(rect, componentName, 'Component');
  }

  private drawTooltip(rect: DOMRect, componentName: string, typeInfo: string) {
    const tooltipX = rect.right + 12;
    const tooltipY = rect.top;
    const padding = 12;
    const lineHeight = 16;
    const radius = 8;

    this.ctx.font = '12px monospace';
    const componentWidth = this.ctx.measureText(componentName).width;
    const typeWidth = this.ctx.measureText(typeInfo).width;
    const maxWidth = Math.max(componentWidth, typeWidth);
    const tooltipWidth = maxWidth + padding * 2;
    const tooltipHeight = lineHeight * 2 + padding * 2;

    // Draw rounded background matching toolbar style
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    this.ctx.beginPath();
    this.ctx.moveTo(tooltipX + radius, tooltipY);
    this.ctx.lineTo(tooltipX + tooltipWidth - radius, tooltipY);
    this.ctx.quadraticCurveTo(
      tooltipX + tooltipWidth,
      tooltipY,
      tooltipX + tooltipWidth,
      tooltipY + radius
    );
    this.ctx.lineTo(tooltipX + tooltipWidth, tooltipY + tooltipHeight - radius);
    this.ctx.quadraticCurveTo(
      tooltipX + tooltipWidth,
      tooltipY + tooltipHeight,
      tooltipX + tooltipWidth - radius,
      tooltipY + tooltipHeight
    );
    this.ctx.lineTo(tooltipX + radius, tooltipY + tooltipHeight);
    this.ctx.quadraticCurveTo(
      tooltipX,
      tooltipY + tooltipHeight,
      tooltipX,
      tooltipY + tooltipHeight - radius
    );
    this.ctx.lineTo(tooltipX, tooltipY + radius);
    this.ctx.quadraticCurveTo(tooltipX, tooltipY, tooltipX + radius, tooltipY);
    this.ctx.closePath();
    this.ctx.fill();

    // Draw border matching toolbar style
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // Draw centered text
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    const centerX = tooltipX + tooltipWidth / 2;
    this.ctx.fillStyle = 'rgb(255, 255, 255)';
    this.ctx.fillText(componentName, centerX, tooltipY + padding);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    this.ctx.fillText(typeInfo, centerX, tooltipY + padding + lineHeight);
    this.ctx.textAlign = 'start'; // Reset to default
    this.ctx.textBaseline = 'alphabetic'; // Reset to default
  }
}

declare global {
  interface Window {
    __reactDebuggerOverlay?: DebugOverlay;
  }
}

// Auto-initialize only in browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.__reactDebuggerOverlay = new DebugOverlay();
}
