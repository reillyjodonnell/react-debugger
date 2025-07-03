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

class DebugOverlay {
  private ws: WebSocket;
  private overlay: HTMLDivElement;
  private logs: HTMLDivElement;

  constructor() {
    this.overlay = this.createOverlay();
    this.logs = this.overlay.querySelector('.rd-logs')!;
    this.ws = new WebSocket(WS_URL);
    this.ws.onopen = () => this.addLog('info', 'Connected to debug server');
    this.ws.onmessage = (e) => this.handleMessage(e.data);
    this.ws.onclose = () => this.addLog('warn', 'WebSocket connection closed');
    this.ws.onerror = () => this.addLog('error', 'WebSocket error');
  }

  private createOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      width: 340px;
      max-height: 50vh;
      background: rgba(20,20,20,0.98);
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      border-radius: 8px;
      box-shadow: 0 2px 16px #0008;
      z-index: 999999;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;
    overlay.innerHTML = `
      <div style="padding:8px 12px; border-bottom:1px solid #333; display:flex; align-items:center; justify-content:space-between;">
        <span style="font-weight:bold;">React Debugger</span>
        <button style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;" title="Close">×</button>
      </div>
      <div class="rd-logs" style="flex:1;overflow-y:auto;padding:8px 12px;"></div>
    `;
    overlay.querySelector('button')!.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    return overlay;
  }

  private addLog(type: string, msg: string) {
    const div = document.createElement('div');
    div.style.marginBottom = '4px';
    div.innerHTML = `<span style="color:${this.color(
      type
    )};font-weight:bold;margin-right:8px;">${type.toUpperCase()}</span><span>${msg}</span>`;
    this.logs.appendChild(div);
    this.logs.scrollTop = this.logs.scrollHeight;
    // Keep only last 100 logs
    if (this.logs.children.length > 100)
      this.logs.removeChild(this.logs.firstChild!);
  }

  private handleMessage(data: string) {
    try {
      const msg = JSON.parse(data);
      this.addLog(msg.type, msg.log);
    } catch {}
  }

  private color(type: string) {
    switch (type) {
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
  }
}

declare global {
  interface Window {
    __reactDebuggerOverlay?: DebugOverlay;
  }
}

// Auto-initialize
if (typeof window !== 'undefined') {
  window.__reactDebuggerOverlay = new DebugOverlay();
}
