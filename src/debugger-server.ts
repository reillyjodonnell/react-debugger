import { fileURLToPath, serve } from 'bun';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = serve({
  port: 5679,
  fetch(req, server) {
    const url = new URL(req.url);

    // CORS proxy for CDP discovery
    if (url.pathname === '/cdp/list') {
      return fetch('http://localhost:9222/json/list', {
        headers: {
          Accept: 'application/json',
        },
      })
        .then((response) => {
          return new Response(response.body, {
            status: response.status,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type',
            },
          });
        })
        .catch((error) => {
          console.error('Failed to fetch CDP targets:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to fetch CDP targets' }),
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          );
        });
    }

    // WebSocket proxy endpoint
    if (url.pathname === '/ws') {
      const success = server.upgrade(req);
      return success
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Serve the debugger widget HTML
    if (url.pathname === '/debugger') {
      const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>React Debugger</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f0f0f;
            color: #ffffff;
            overflow: hidden;
        }
        #root {
            width: 100vw;
            height: 100vh;
        }
        /* Prevent text selection for better UX */
        * {
            -webkit-user-select: none;
            -moz-user-select: none;
            -ms-user-select: none;
            user-select: none;
        }
        /* Allow text selection in code areas */
        pre, code, .code {
            -webkit-user-select: text;
            -moz-user-select: text;
            -ms-user-select: text;
            user-select: text;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/debugger-widget.js"></script>
</body>
</html>`;

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (url.pathname === '/debugger-widget.js') {
      // Look for the file in the SAME directory as this server file
      return new Response(
        Bun.file(path.join(__dirname, 'debugger-widget.js')),
        {
          headers: {
            'Content-Type': 'application/javascript',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        }
      );
    }

    // Fallback for old path
    if (url.pathname === '/debugger.html') {
      return new Response('', {
        status: 302,
        headers: {
          Location: '/debugger',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    open(ws) {
      console.log('WebSocket proxy connection opened');
    },
    message(ws, message) {
      try {
        const data = JSON.parse(message as string);
        console.log('Received message:', data);

        // If this is a connection request, establish connection to CDP
        if (data.type === 'CONNECT_CDP' && data.targetId) {
          const cdpWsUrl = `ws://localhost:9222/devtools/page/${data.targetId}`;
          console.log('Connecting to CDP:', cdpWsUrl);

          // Create CDP WebSocket connection
          const cdpWs = new WebSocket(cdpWsUrl);

          cdpWs.addEventListener('open', () => {
            console.log('Connected to CDP WebSocket');
            // Store the CDP connection for this client
            (ws as any).cdpConnection = cdpWs;
            ws.send(JSON.stringify({ type: 'CDP_CONNECTED' }));
          });

          cdpWs.addEventListener('message', (event) => {
            console.log('CDP message received:', event.data);
            // Forward CDP messages to the client
            ws.send(event.data);
          });

          cdpWs.addEventListener('error', (error: Event) => {
            console.error('CDP WebSocket error:', error);
            ws.send(
              JSON.stringify({
                type: 'CDP_ERROR',
                error: 'Connection failed',
              })
            );
          });

          cdpWs.addEventListener('close', () => {
            console.log('CDP WebSocket closed');
            (ws as any).cdpConnection = null;
            ws.send(JSON.stringify({ type: 'CDP_CLOSED' }));
          });
        } else {
          // Forward other messages to CDP
          const cdpWs = (ws as any).cdpConnection;
          console.log(
            'Forwarding message to CDP, connection state:',
            cdpWs?.readyState
          );
          if (cdpWs && cdpWs.readyState === WebSocket.OPEN) {
            console.log('Sending to CDP:', message);
            cdpWs.send(message);
          } else {
            console.error(
              'CDP WebSocket not connected, readyState:',
              cdpWs?.readyState
            );
            ws.send(
              JSON.stringify({
                type: 'CDP_ERROR',
                error: 'CDP WebSocket not connected',
              })
            );
          }
        }
      } catch (error: unknown) {
        console.error('Error handling WebSocket message:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        ws.send(
          JSON.stringify({
            type: 'CDP_ERROR',
            error: `Message parsing error: ${errorMessage}`,
          })
        );
      }
    },
    close(ws) {
      console.log('WebSocket proxy connection closed');
      // Close CDP connection if it exists
      const cdpWs = (ws as any).cdpConnection;
      if (cdpWs) {
        cdpWs.close();
      }
    },
  },
});

console.log('Debugger widget server running at http://127.0.0.1:5679');
console.log('Access the debugger at http://127.0.0.1:5679/debugger');
