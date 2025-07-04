// src/debug-server.ts
// Bun-based debug server for React overlay

import type { ServerWebSocket } from 'bun';
import { decode } from 'sourcemap-codec';

// --- CONFIG ---
const CDP_PORT = 9222; // Chrome remote debugging port
const WS_PORT = 5678; // WebSocket port for overlay clients

// --- CDP Connection ---
let cdpSocket: WebSocket | null = null;
let wsClients: Set<ServerWebSocket<any>> = new Set();
let messageId = 0;
let pendingMessages = new Map();
let activeBreakpoints = new Set<string>(); // Track active breakpoints to avoid duplicates
let sourceMapCache = new Map<string, any>(); // Cache source maps

async function connectToCDP() {
  try {
    // Get list of targets
    const resp = await fetch(`http://localhost:${CDP_PORT}/json/list`);
    const targets = await resp.json();

    console.log('Available targets:');
    targets.forEach((target: any) => {
      console.log(`- ${target.type}: ${target.url} (${target.title})`);
    });

    // Look for your app page, not devtools
    console.log('Looking for page with localhost:5173...');
    const page = targets.find((t: any) => {
      const isPage = t.type === 'page';
      const hasLocalhost = t.url && t.url.includes('localhost:5173');
      console.log(
        `Checking target: type=${t.type}, url=${t.url}, isPage=${isPage}, hasLocalhost=${hasLocalhost}`
      );
      return isPage && hasLocalhost;
    });

    if (!page) {
      console.error(
        'No page target found for localhost:5173. Available targets:'
      );
      targets.forEach((t: any) => console.log(`  - ${t.url}`));
      console.log(
        'Make sure Chrome is open to http://localhost:5173 and the page is active'
      );
      return;
    }

    console.log('Connecting to app page:', page.url);
    cdpSocket = new WebSocket(page.webSocketDebuggerUrl);
    cdpSocket.addEventListener('open', async () => {
      console.log('Connected to Chrome CDP');

      try {
        // Enable required domains
        await sendCDPCommand('Runtime.enable');
        await sendCDPCommand('Console.enable');
        await sendCDPCommand('Debugger.enable');

        console.log('All CDP domains enabled successfully');
      } catch (error) {
        console.error('Failed to enable CDP domains:', error);
      }
    });
    cdpSocket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      // Handle CDP command responses
      if (msg.id && pendingMessages.has(msg.id)) {
        const { resolve, reject } = pendingMessages.get(msg.id);
        pendingMessages.delete(msg.id);

        if (msg.error) {
          console.error('CDP command failed:', msg.error);
          reject(new Error(msg.error.message));
        } else {
          console.log('CDP command succeeded:', msg.result);
          resolve(msg.result);
        }
        return;
      }

      // Handle breakpoint responses
      if (msg.id && msg.result) {
        console.log('CDP response:', msg);
        // Could broadcast breakpoint success/failure to overlay clients
        if (msg.result.breakpointId) {
          broadcast({
            type: 'info',
            log: `Breakpoint set successfully: ${msg.result.breakpointId}`,
          });
        }
      }

      // Log all scripts Chrome finds (only those with URLs)
      if (msg.method === 'Debugger.scriptParsed') {
        const { scriptId, url, sourceMapURL } = msg.params;
        if (url && url.length > 0) {
          console.log('Script parsed:', {
            scriptId,
            url,
            sourceMapURL: sourceMapURL ? 'present' : 'none',
          });
        }
      }

      // Forward relevant messages to overlay clients (commented out for cleaner logs)
      // if (msg.method === 'Runtime.consoleAPICalled') {
      //   const { type, args, executionContextId } = msg.params;
      //   if (shouldCaptureFromContext(executionContextId, msg)) {
      //     const log = args
      //       .map((a: any) => a.value || a.description || '')
      //       .join(' ');
      //     broadcast({ type, log, raw: msg });
      //   }
      // }
      // if (msg.method === 'Console.messageAdded') {
      //   const { message } = msg.params;
      //   if (shouldCaptureMessage(message)) {
      //     broadcast({ type: message.level, log: message.text, raw: msg });
      //   }
      // }
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

// Send command to CDP with proper response handling
function sendCDPCommand(method: string, params: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) {
      reject(new Error('CDP WebSocket not connected'));
      return;
    }

    const id = ++messageId;
    pendingMessages.set(id, { resolve, reject });

    const message = {
      id,
      method,
      params,
    };

    console.log('Sending CDP command:', message);
    cdpSocket.send(JSON.stringify(message));
  });
}

// Fetch and parse source map for a given URL
async function getSourceMap(jsFileURL: string): Promise<any> {
  if (sourceMapCache.has(jsFileURL)) {
    return sourceMapCache.get(jsFileURL);
  }

  try {
    console.log('Fetching source map for:', jsFileURL);

    // Fetch the JS file
    const jsContent = await fetch(jsFileURL).then((r) => r.text());

    // Find source map
    const lines = jsContent.split('\n');
    const sourceMapLine = lines.find((line) =>
      line.includes('sourceMappingURL=')
    );

    if (!sourceMapLine) {
      console.log('No source map found in:', jsFileURL);
      return null;
    }

    let sourceMapData;

    if (sourceMapLine.includes('data:application/json;base64,')) {
      // Inline source map
      const base64 = sourceMapLine.split('base64,')[1];
      if (base64) {
        sourceMapData = JSON.parse(atob(base64));
      }
    } else {
      // External source map
      const mapURL = sourceMapLine.split('sourceMappingURL=')[1];
      if (mapURL) {
        const fullMapURL = new URL(mapURL, jsFileURL).toString();
        console.log('Fetching external source map from:', fullMapURL);
        const mapContent = await fetch(fullMapURL).then((r) => r.text());
        sourceMapData = JSON.parse(mapContent);
      }
    }

    // Cache the source map
    sourceMapCache.set(jsFileURL, sourceMapData);
    console.log('Source map loaded successfully');

    return sourceMapData;
  } catch (error) {
    console.error('Failed to load source map for:', jsFileURL, error);
    return null;
  }
}

// Map FROM original source TO minified position
async function findMinifiedPosition(
  jsFileURL: string,
  originalSourceURL: string,
  originalLine: number,
  originalColumn: number = 0
) {
  try {
    const sourceMapData = await getSourceMap(jsFileURL);
    if (!sourceMapData) return null;

    console.log('Source map sources:', sourceMapData.sources);
    console.log('Looking for source:', originalSourceURL);

    // Log all sources that might match
    const possibleMatches = sourceMapData.sources.filter(
      (source: string) =>
        source.includes('App.tsx') ||
        source.includes('App') ||
        originalSourceURL.includes(source)
    );
    console.log('Possible matching sources:', possibleMatches);

    // Find the source index - try multiple matching strategies
    let sourceIndex = sourceMapData.sources.findIndex(
      (source: string) =>
        source.includes(originalSourceURL) || originalSourceURL.includes(source)
    );

    // If not found, try matching just the filename
    if (sourceIndex === -1) {
      const fileName = originalSourceURL.split('/').pop(); // Get "App.tsx"
      sourceIndex = sourceMapData.sources.findIndex((source: string) =>
        source.includes(fileName || '')
      );
    }

    // If still not found, try matching without the domain
    if (sourceIndex === -1) {
      const pathWithoutDomain = originalSourceURL.replace(
        /^https?:\/\/[^\/]+/,
        ''
      );
      sourceIndex = sourceMapData.sources.findIndex(
        (source: string) =>
          source.includes(pathWithoutDomain) ||
          pathWithoutDomain.includes(source)
      );
    }

    console.log('Found source index:', sourceIndex);

    if (sourceIndex === -1) {
      console.log('Source not found in source map');
      return null;
    }

    const decodedMappings = decode(sourceMapData.mappings);

    if (sourceIndex !== -1) {
      console.log('Decoded mappings sample:', decodedMappings[0]?.slice(0, 3));
    }

    // Search through all mappings to find one that maps to our original position
    let mappingCount = 0;
    for (let lineIndex = 0; lineIndex < decodedMappings.length; lineIndex++) {
      const lineMappings = decodedMappings[lineIndex];
      if (!lineMappings) continue;

      for (const mapping of lineMappings) {
        const [genColumn, srcIndex, origLine, origColumn] = mapping;
        mappingCount++;

        if (srcIndex === sourceIndex) {
          console.log(`Found mapping for source ${sourceIndex}:`, {
            genColumn,
            origLine: (origLine || 0) + 1,
            origColumn: origColumn || 0,
            targetLine: originalLine,
            targetColumn: originalColumn,
          });
        }

        if (
          srcIndex === sourceIndex &&
          (origLine || 0) + 1 === originalLine && // +1 because mappings are 0-based
          Math.abs((origColumn || 0) - originalColumn) < 5 // Allow some column tolerance
        ) {
          console.log('Found matching mapping!');
          return {
            line: lineIndex + 1, // Convert back to 1-based
            column: genColumn,
          };
        }
      }
    }

    console.log(
      `Searched through ${mappingCount} mappings, no match found for line ${originalLine}`
    );

    console.log('No mapping found for position:', {
      originalLine,
      originalColumn,
    });
    return null;
  } catch (error) {
    console.error('Failed to find minified position:', error);
    return null;
  }
}

// --- Breakpoint Handling ---
async function handleBreakpointRequest(data: any, ws: ServerWebSocket<any>) {
  if (!cdpSocket || cdpSocket.readyState !== WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'error',
        log: 'CDP not connected, cannot set breakpoint',
      })
    );
    return;
  }

  // Create a unique key for this breakpoint
  const breakpointKey = `${data.params.url}:${data.params.lineNumber}`;

  // Check if breakpoint already exists
  if (activeBreakpoints.has(breakpointKey)) {
    ws.send(
      JSON.stringify({
        type: 'info',
        log: `Breakpoint already exists at ${data.params.url}:${
          data.params.lineNumber + 1
        }`,
      })
    );
    return;
  }

  try {
    console.log('Setting breakpoint for URL:', data.params.url);
    console.log('Line number:', data.params.lineNumber);

    // data.params contains the ORIGINAL source position
    const originalSourceURL = data.params.url; // e.g., "App.tsx"
    const originalLine = data.params.lineNumber; // e.g., 25
    const originalColumn = data.params.columnNumber || 0;

    console.log('Setting breakpoint for ORIGINAL source:', {
      url: originalSourceURL,
      line: originalLine,
      column: originalColumn,
    });

    // Try multiple URL formats to find one that Chrome recognizes
    const urlsToTry = [
      originalSourceURL, // "http://localhost:5173/src/App.tsx"
      originalSourceURL.replace('http://localhost:5173/', ''), // "src/App.tsx"
      originalSourceURL.split('/').pop(), // "App.tsx"
      `src/${originalSourceURL.split('/').pop()}`, // "src/App.tsx"
      `./src/${originalSourceURL.split('/').pop()}`, // "./src/App.tsx"
    ];

    console.log('Trying multiple URL formats:', urlsToTry);

    for (const url of urlsToTry) {
      try {
        console.log(`Trying breakpoint on: ${url}`);
        const result = await sendCDPCommand('Debugger.setBreakpointByUrl', {
          lineNumber: originalLine - 1,
          url: url,
          columnNumber: originalColumn,
        });

        console.log(`Result for ${url}:`, result);
        console.log(`Locations for ${url}:`, result.locations);

        if (result.locations && result.locations.length > 0) {
          console.log(`SUCCESS: Breakpoint resolved with ${url}`);
          activeBreakpoints.add(breakpointKey);
          ws.send(
            JSON.stringify({
              type: 'info',
              log: `Breakpoint set on: ${url}:${originalLine} (ID: ${result.breakpointId})`,
            })
          );
          return;
        }
      } catch (error) {
        console.log(`Failed with ${url}:`, (error as Error).message);
      }
    }

    console.log(
      'WARNING: All URL formats failed - Chrome could not resolve any URL'
    );

    // If that failed, try the bundle approach
    console.log('Original source failed, trying bundle mapping...');
    const bundleURL =
      'http://localhost:5173/@fs/Users/reilly/programming/experiments/react-debugger/dist/index.js';
    const minifiedPosition = await findMinifiedPosition(
      bundleURL,
      originalSourceURL,
      originalLine,
      originalColumn
    );

    if (minifiedPosition) {
      const bundleResult = await sendCDPCommand('Debugger.setBreakpointByUrl', {
        lineNumber: minifiedPosition.line - 1,
        url: bundleURL,
        columnNumber: minifiedPosition.column,
      });

      console.log('Bundle mapping result:', bundleResult);
      console.log('Bundle locations found:', bundleResult.locations);

      if (bundleResult.locations && bundleResult.locations.length > 0) {
        console.log('SUCCESS: Breakpoint resolved on bundle');
        activeBreakpoints.add(breakpointKey);
        ws.send(
          JSON.stringify({
            type: 'info',
            log: `Breakpoint mapped to bundle: ${bundleURL}:${minifiedPosition.line} (ID: ${bundleResult.breakpointId})`,
          })
        );
        return;
      }
    }

    // If everything failed
    ws.send(
      JSON.stringify({
        type: 'error',
        log: `Could not resolve breakpoint for ${originalSourceURL}:${originalLine}`,
      })
    );
  } catch (error) {
    console.error('Error setting breakpoint:', error);
    ws.send(
      JSON.stringify({
        type: 'error',
        log: `Failed to set breakpoint: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    );
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
      console.log(`Overlay client connected. Total clients: ${wsClients.size}`);
    },
    close(ws) {
      wsClients.delete(ws);
      console.log(
        `Overlay client disconnected. Total clients: ${wsClients.size}`
      );
    },
    message(ws, msg) {
      try {
        const data = JSON.parse(msg as string);

        // Handle breakpoint requests from overlay
        if (data.method === 'Debugger.setBreakpointByUrl') {
          handleBreakpointRequest(data, ws);
        }
      } catch (error) {
        console.error('Error parsing message from overlay:', error);
      }
    },
  },
});

console.log(`React Debugger server running!`);
console.log(
  `- Connect Chrome with: chrome --remote-debugging-port=${CDP_PORT}`
);
console.log(`- Overlay clients connect to ws://localhost:${WS_PORT}`);

connectToCDP();
