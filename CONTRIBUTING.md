# Contributing to React Debugger

## Development Setup

```bash
bun install
bun run build
```

## Development Workflow

### Option 1: Testing with the included example project

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

4. **Navigate to the example app** (usually `http://localhost:5173`)
   - The React Debugger overlay should appear
   - The debugger window should open automatically

**Note:** `bun run chrome` only works on macOS. On other systems, start Chrome manually with `--remote-debugging-port=9222`.

### Option 2: Testing with an external React project

This simulates the real-world usage experience:

1. **Build the package:**

   ```bash
   bun run build
   ```

2. **Pack the package locally:**

   ```bash
   npm pack
   ```

   This creates a tarball like `react-debugger-core-0.0.5.tgz`

3. **Install globally for CLI testing:**

   ```bash
   sudo npm install -g ./react-debugger-core-0.0.5.tgz
   ```

4. **Test in your React project:**

   ```bash
   cd /path/to/your/react/project
   
   # Add the script tag to your HTML
   # <script src="//unpkg.com/@react-debugger/core/dist/index.js"></script>
   
   # Start your React dev server
   npm run dev  # or yarn dev
   
   # In another terminal, start the debugger
   npx @react-debugger/core localhost:3000  # or your app's port
   ```

5. **Clean up when done:**

   ```bash
   sudo npm uninstall -g @react-debugger/core
   ```

## Testing the published package experience

For testing how the package works when published to npm:

1. **Build everything:**

   ```bash
   bun run build
   ```

2. **Test the CLI directly:**

   ```bash
   bun dist/cli.js localhost:3000
   ```

3. **Test the script tag locally:**

   ```bash
   # Serve the files - this simulates unpkg
   bunx serve dist --cors -p 8080

   # Add to your test app's HTML
   <script src="http://localhost:8080/index.js"></script>
   ```

## Debugging Tips

- Check browser console for errors when the overlay doesn't appear
- Ensure Chrome is running with `--remote-debugging-port=9222`
- Verify the React app is accessible and running
- The debugger server runs on port 5679 by default

## Publishing

```bash
npm publish --access public
```
