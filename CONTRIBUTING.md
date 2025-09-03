# Contributing to React Debugger

## Development Setup

```bash
bun install
```

## Development Workflow

Typical quick flow:

1. Make your code changes.
2. Rebuild and publish the local dev binary:

```bash
bun run local
```

What `bun run local` does:

- Builds updated files into `/dist`.
- Creates a tarball binary and installs it globally so you can invoke the CLI via `npx @react-debugger/core`.
- Runs a tiny HTTP server to serve files (so the runtime can fetch the bridge bundle, similar to unpkg).

3. Run the CLI command you need, e.g.:

```bash
npx @react-debugger/core init
# or any other command
npx @react-debugger/core mcp
```

**Be sure to overwrite the script** generated on the client's html entry:

<script src="//unpkg.com/@react-debugger/core/dist/react-bridge-client.js"></script>

should point to local http server!

<script src="//localhost:8080/dist/react-bridge-client.js"></script>

Optional: preview the MCP server (useful when testing server behavior):

```bash
npx @modelcontextprotocol/inspector bun run ./src/cli.ts mcp
```

Notes

- Usually: edit → `bun run local` → `npx @react-debugger/core <command>` — that's all you need.
- If you change files that affect the served bridge or packaging, rerun `bun run local` before testing.

## Releasing a new version

1. Make sure `main` is up to date and tests/build pass.
2. Run the following (replace version as needed):

   ```bash
   npm version <new-version> -m "release %s"
   git push origin main --tags
   ```
