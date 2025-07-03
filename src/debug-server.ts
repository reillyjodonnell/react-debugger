// src/debug-server.ts
// Bun-based debug server for React overlay

import type { ServerWebSocket } from 'bun';

// --- CONFIG ---
const CDP_PORT = 9222; // Chrome remote debugging port
const WS_PORT = 5678; // WebSocket port for overlay clients

// --- CDP Connection ---
let cdpSocket: WebSocket | null = null;
let wsClients: Set<ServerWebSocket<any>> = new Set();

async function connectToCDP() {
  try {
    // Get list of targets
    const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
    const targets = await resp.json();
    const page = targets.find((t: any) => t.type === 'page');
    if (!page) {
      console.error(
        'No page target found. Is Chrome running with --remote-debugging-port=9222?'
      );
      return;
    }
    cdpSocket = new WebSocket(page.webSocketDebuggerUrl);
    cdpSocket.addEventListener('open', () => {
      console.log('Connected to Chrome CDP');
      cdpSocket!.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      cdpSocket!.send(JSON.stringify({ id: 2, method: 'Console.enable' }));
    });
    cdpSocket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      // Forward relevant messages to overlay clients
      if (msg.method === 'Runtime.consoleAPICalled') {
        const { type, args } = msg.params;
        const log = args
          .map((a: any) => a.value || a.description || '')
          .join(' ');
        broadcast({ type, log, raw: msg });
      }
      if (msg.method === 'Console.messageAdded') {
        const { message } = msg.params;
        broadcast({ type: message.level, log: message.text, raw: msg });
      }
    });
    cdpSocket.addEventListener('close', () => {
      console.log('CDP socket closed. Retrying in 2s...');
      setTimeout(connectToCDP, 2000);
    });
    cdpSocket.addEventListener('error', (e) => {
      console.error('CDP socket error:', e);
    });
  } catch (e) {
    console.error('Failed to connect to CDP:', e);
    setTimeout(connectToCDP, 2000);
  }
}

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// --- WebSocket Server for Overlay Clients ---
Bun.serve<{ ws: WebSocket }, any>({
  port: WS_PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return undefined;
    return new Response('React Debugger WebSocket server', { status: 200 });
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: 'info', log: 'Overlay connected!' }));
    },
    close(ws) {
      wsClients.delete(ws);
    },
    message(ws, msg) {
      // Optionally handle messages from overlay clients
    },
  },
});

console.log(`React Debugger server running!`);
console.log(
  `- Connect Chrome with: chrome --remote-debugging-port=${CDP_PORT}`
);
console.log(`- Overlay clients connect to ws://localhost:${WS_PORT}`);

connectToCDP();
