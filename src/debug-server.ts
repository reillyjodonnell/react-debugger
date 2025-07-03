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
        const { type, args, executionContextId } = msg.params;

        console.log('Console API called:', {
          type,
          args,
          url: msg.params?.url,
        });

        // Only capture logs from our app (localhost:5173 for Vite dev server)
        if (shouldCaptureFromContext(executionContextId, msg)) {
          const log = args
            .map((a: any) => a.value || a.description || '')
            .join(' ');

          broadcast({ type, log, raw: msg });
        }
      }
      if (msg.method === 'Console.messageAdded') {
        const { message } = msg.params;

        console.log('Console message added:', {
          level: message.level,
          text: message.text,
          url: message.url,
        });

        // Only capture messages from our app
        if (shouldCaptureMessage(message)) {
          broadcast({ type: message.level, log: message.text, raw: msg });
        }
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

// Simple filtering to only capture logs from our app
function shouldCaptureFromContext(
  executionContextId: number,
  msg: any
): boolean {
  // Check if the message URL contains our app's domain
  const url = msg.params?.url || '';

  // Only capture if it's from our app but NOT from the debugger itself
  const isFromApp =
    url.includes('localhost:5173') || url.includes('127.0.0.1:5173');
  const isFromDebugger =
    url.includes('dist/index.js') ||
    url.includes('react-debugger') ||
    url.includes('@fs/');

  const shouldCapture = isFromApp && !isFromDebugger;
  if (shouldCapture) {
    console.log('Capturing console log from:', url);
  } else {
    console.log('Filtering out console log from:', url);
  }
  return shouldCapture;
}

function shouldCaptureMessage(message: any): boolean {
  // Check if the message URL contains our app's domain
  const url = message.url || '';

  // Only capture if it's from our app but NOT from the debugger itself
  const isFromApp =
    url.includes('localhost:5173') || url.includes('127.0.0.1:5173');
  const isFromDebugger =
    url.includes('dist/index.js') ||
    url.includes('react-debugger') ||
    url.includes('@fs/');

  const shouldCapture = isFromApp && !isFromDebugger;
  if (shouldCapture) {
    console.log('Capturing message from:', url);
  } else {
    console.log('Filtering out message from:', url);
  }
  return shouldCapture;
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
