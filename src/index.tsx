// src/index.tsx
// React Debugger: High-performance canvas overlay + React UI

import {
  getFiberRects,
  getComponentNameForElement,
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
  breakpoints: Array<{ id: string; component: string; line: number }>;
  isHighlighting: boolean;
  isPaused: boolean;
}

// React Log Widget Component
const LogWidget: React.FC<{
  logs: Array<{ type: string; message: string; timestamp: number }>;
}> = ({ logs }) => {
  const getLogColor = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'error':
        return '#ff6b6b';
      case 'warn':
        return '#ffd93d';
      case 'info':
        return '#4ecdc4';
      case 'debug':
        return '#95e1d3';
      default:
        return '#fff';
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        width: '400px',
        maxHeight: '400px',
        background: 'rgba(0, 0, 0, 0.9)',
        color: '#fff',
        fontFamily: 'monospace',
        fontSize: '12px',
        borderRadius: '8px',
        padding: '12px',
        zIndex: 999999,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      }}
    >
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
          onClick={() => {
            const widget = document.getElementById('react-debugger-widget');
            if (widget) widget.remove();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '0',
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
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          maxHeight: '300px',
        }}
      >
        {logs.slice(-10).map((log, index) => (
          <div
            key={index}
            style={{
              marginBottom: '4px',
              padding: '2px 0',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            <span
              style={{
                color: getLogColor(log.type),
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
    </div>
  );
};

class DebugOverlay {
  private ws!: WebSocket;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mouseX: number = 0;
  private mouseY: number = 0;
  private logs: Array<{ type: string; message: string; timestamp: number }> =
    [];
  private animationId: number | null = null;
  private logWidgetRoot: any = null;
  private isHighlighting: boolean = true;

  constructor() {
    this.canvas = this.createCanvas();
    this.ctx = this.canvas.getContext('2d')!;
    this.resizeCanvas();
    this.setupMouseTracking();
    this.setupWebSocket();
    this.createLogWidget();
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

  private createLogWidget() {
    if (typeof document === 'undefined') return;

    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'react-debugger-widget';
    document.body.appendChild(widgetContainer);

    this.logWidgetRoot = createRoot(widgetContainer);
    this.updateLogWidget();
  }

  private updateLogWidget() {
    if (this.logWidgetRoot) {
      this.logWidgetRoot.render(<LogWidget logs={this.logs} />);
    }
  }

  private toggleHighlighting() {
    this.isHighlighting = !this.isHighlighting;
    this.updateLogWidget();
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
  }

  private setupWebSocket() {
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => this.addLog('info', 'Connected to debug server');
    this.ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws.onclose = () => this.addLog('warn', 'WebSocket connection closed');
    this.ws.onerror = () => this.addLog('error', 'WebSocket error');
  }

  private addLog(type: string, message: string) {
    this.logs.push({ type, message, timestamp: Date.now() });
    if (this.logs.length > 50) {
      this.logs.shift();
    }
    this.updateLogWidget();
  }

  private handleMessage(data: string) {
    try {
      const msg = JSON.parse(data);
      this.addLog(msg.type, msg.log);
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
    this.drawFiberHighlights();
  }

  private drawFiberHighlights() {
    if (typeof document === 'undefined' || !this.isHighlighting) return;

    const hoveredElement = document.elementFromPoint(
      this.mouseX,
      this.mouseY
    ) as HTMLElement;

    if (!hoveredElement) return;

    // Find the component that rendered this element
    const componentInfo = this.getComponentForElement(hoveredElement);
    if (componentInfo) {
      this.drawComponentHighlight(componentInfo.rect, componentInfo.name);
    }
  }

  private getComponentForElement(
    element: HTMLElement
  ): { rect: DOMRect; name: string } | null {
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
        return { rect, name };
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

  private drawComponentHighlight(rect: DOMRect, componentName: string) {
    // Draw light purple background
    this.ctx.fillStyle = 'rgba(147, 112, 219, 0.1)';
    this.ctx.fillRect(rect.left, rect.top, rect.width, rect.height);

    // Draw dashed purple border
    this.ctx.strokeStyle = 'rgba(147, 112, 219, 0.8)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.strokeRect(
      rect.left - 2,
      rect.top - 2,
      rect.width + 4,
      rect.height + 4
    );
    this.ctx.setLineDash([]); // Reset dash pattern

    this.drawTooltip(rect, componentName, 'Component');
  }

  private drawTooltip(rect: DOMRect, componentName: string, typeInfo: string) {
    const tooltipX = rect.right + 10;
    const tooltipY = rect.top;
    const padding = 8;
    const lineHeight = 16;

    this.ctx.font = '12px monospace';
    const componentWidth = this.ctx.measureText(componentName).width;
    const typeWidth = this.ctx.measureText(typeInfo).width;
    const maxWidth = Math.max(componentWidth, typeWidth);

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    this.ctx.fillRect(
      tooltipX - padding,
      tooltipY - padding,
      maxWidth + padding * 2,
      lineHeight * 2 + padding * 2
    );

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(
      tooltipX - padding,
      tooltipY - padding,
      maxWidth + padding * 2,
      lineHeight * 2 + padding * 2
    );

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillText(componentName, tooltipX, tooltipY + lineHeight);
    this.ctx.fillStyle = 'rgba(200, 200, 200, 0.8)';
    this.ctx.fillText(typeInfo, tooltipX, tooltipY + lineHeight * 2);
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
