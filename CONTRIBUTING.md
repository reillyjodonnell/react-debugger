# Contributing to React Debugger

## Development Setup

```bash
bun install
bun run build
```

## Working on the debugger source code

1. **Start Chrome with debugging flags** (macOS only - see note below)

   ```bash
   bun run chrome
   ```

2. **Start the debugger server:**

   ```bash
   bun run src/debugger-server.ts
   ```

3. **Open the example app:**
   ```bash
   cd example && bun run dev
   ```

**Note:** `bun run chrome` only works on macOS. On other systems, start Chrome manually with `--remote-debugging-port=9222`.

## Testing the published package experience

1. **Build everything:**

   ```bash
   bun run build
   ```

2. **Test the CLI:**

   ```bash
   bun dist/cli.js localhost:3000
   ```

3. **Test the script tag:**

   ```bash
   # Serve the files - this is how unpkg works
   bunx serve dist --cors -p 8080

   # Add to your test app
   <script src="http://localhost:8080/index.js"></script>
   ```

## Publishing

```bash
npm publish --access public
```
