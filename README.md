# React Debugger

Visual React debugging with component inspection, commit diffs, and MCP integration.

> ⚠️ Alpha. APIs and channels may change. Built for humans and agents alike.

## Quick Start (Local)

1. Install and build once (uses Bun for builds):

```bash
bun install
bun run build
```

2. Serve the client bundle (optional, for the visual overlay demo and agent script):

```bash
bunx serve dist --cors -p 8080
```

3. Add the agent script to your app during development:

```html
<script src="http://localhost:8080/react-bridge-client.js"></script>
<!-- or self-host the built file: ./dist/react-bridge-client.js -->
```

4. Start the debugger in human mode (opens Chrome with remote debugging):

```bash
react-debugger-core localhost:3000

If you haven’t installed the CLI globally, see the options below.
```

5. Visit the widget UI (optional demo):

- http://localhost:5679/debugger

## MCP Server (Agents)

Your MCP client should load `mcp.json` similar to the one in this repo. The MCP server communicates over STDIO to your client and uses a WebSocket on `ws://localhost:5679` to talk to the in‑page agent.

Choose one of these local workflows:

- A) Run from source (no npm pack):

```bash
bun run build
bun ./dist/cli.js --mcp-server
```

- B) Use a local tarball (matches published flow):

```bash
bun run build
npm pack
# Note the printed tarball name, e.g. react-debugger-core-0.0.9.tgz
npm i -g ./react-debugger-core-0.0.9.tgz
react-debugger-core --mcp-server
```

- C) Published package (pulls from npm):

```bash
npx @react-debugger/core --mcp-server
```

### Streamable HTTP (optional)

The MCP server also exposes a single HTTP endpoint that supports both POST (JSON-RPC) and GET (SSE stream) at `/mcp` on the same port.

- POST: Send JSON-RPC requests and receive a single JSON response for calls with an `id`.
- GET: Receive server notifications as Server-Sent Events (SSE). Use this to tail channels like `commit`, `findings`, and `control`.

POST example (subscribe):

```bash
curl -X POST "http://localhost:5679/mcp" \
   -H "Content-Type: application/json" \
   -d '{
      "jsonrpc": "2.0",
      "id": "req-1",
      "method": "tools/call",
      "params": {
         "name": "subscribe",
         "arguments": {
            "channels": ["commit","findings"],
            "selector": { "displayName": "Row", "propsMatch": { "userId": 123 } }
         }
      }
   }'
```

GET example (SSE tail of notifications):

```html
<script>
  const es = new EventSource('http://localhost:5679/mcp');
  es.onmessage = (ev) => {
    // Each event is a JSON-RPC notification: { jsonrpc, method: "notifications/<channel>", params }
    const msg = JSON.parse(ev.data);
    if (msg.method === 'notifications/commit') {
      // handle commit frames in msg.params
    }
  };
</script>
```

Notes

- CORS is enabled for `/mcp` with basic preflight support.
- SSE streams notifications only; request/response pairs for `tools/call` should use POST.
- Stdout remains supported and unchanged for traditional MCP clients.

### Tools

- subscribe: subscriptionId?, channels [commit|findings|snapshot], selector?, fields?, budgets?
- unsubscribe: subscriptionId
- getProps: fid, commitId?, paths[]
- getHooksState: fid, commitId?, paths[]
- ping: health check

### Channels

- commit: per-commit change envelopes with prop/hooks/context diffs
- findings: low-risk heuristics like identityThrash, infiniteUpdatePattern
- snapshot: initial rows/indexes for a subscription
- control: deref responses and budget notices

### Selectors

Supported keys: displayName (string or { $regex }), file (string or { $regex }), pathContains ("Owner>Child"), keyEquals, costMsGte, propsMatch ({ k: v }).

## Deploy / Build Integration

Two pieces are involved: the MCP server process, and the in-page agent script.

1. Build the package in CI/CD (Bun required for build):

```bash
bun install
bun run build
npm pack
```

Publish or host the tarball/bundle per your workflow.

2. Run the MCP server in your deployment (behind your agent runtime):

```bash
react-debugger-core --mcp-server
```

This server expects a browser page to include the in-page agent script.

3. Serve content with bun server
   `bunx serve dist --cors -p 8080`

4. Inject the in-page agent script in dev or preview builds only:

```html
<script src="/path/to/react-bridge-client.js"></script>
```

If serving the built files locally, the script is available at `http://localhost:8080/react-bridge-client.js`.

Port selection

- Run the server on a custom port:

```bash
react-debugger-core --mcp-server --port 7777
# or
MCP_WS_PORT=7777 react-debugger-core --mcp-server
```

- Point the in-page agent to that port (any of):
  - Pass URL to init: `window.ReactDebuggerMCP.init('ws://localhost:7777')`
  - Script tag attributes: `<script src="/react-bridge-client.js" data-ws-port="7777"></script>`
  - Global var: `window.REACT_DEBUGGER_WS_PORT = 7777`

Security notes:

- Only include the agent in non-production or controlled preview/staging.
- Optionally set an allowlist for origins (future). For now, keep usage local.

## Local Development Tips

- Build watch for the overlay: `bun --watch src/index.tsx`
- Vite example app is in `example/` for testing the agent/client end-to-end.

## What you get

- Visual component highlight and inspection
- Commit-level diffs with why reasons (props/hooks/context)
- Deref RPCs for props and hooks previews
- Findings channel with low-noise heuristics

## Requirements

- Node 18+, Bun 1.0+ (for building)
- React 16.8+
- Chrome (for visual mode)

---

MIT License
