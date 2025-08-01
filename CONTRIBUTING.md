# Contributing to React Debugger

## Development Setup

```bash
bun install
bun run build
```

## Development Workflow

### Option 1: Testing with the included example project

1. **Build the project first:**

   ```bash
   bun run build
   ```

2. **Serve the built files locally (for the overlay script):**

   ```bash
   bunx serve dist --cors -p 8080
   ```

3. **Start Chrome with debugging flags** (macOS only - see note below)

   ```bash
   bun run chrome
   ```

4. **Start the debugger server:**

   ```bash
   bun dist/debugger-server.js
   ```

5. **Open the example app:**
   ```bash
   cd example && bun run dev
   ```

6. **Navigate to the example app** (usually `http://localhost:5173` or `http://localhost:5174`)
   - The React Debugger overlay should appear
   - The debugger window should open automatically

**Note:** `bun run chrome` only works on macOS. On other systems, start Chrome manually with `--remote-debugging-port=9222`.

### Option 2: Testing with an external React project

This simulates the real-world usage experience and tests the complete package workflow:

1. **Build the package:**

   ```bash
   bun run build
   ```

2. **Pack the package locally:**

   ```bash
   npm pack
   ```

   This creates a tarball like `react-debugger-core-0.0.7.tgz`

3. **Install globally for CLI testing:**

   ```bash
   sudo npm install -g ./react-debugger-core-0.0.7.tgz
   ```

4. **Test in your React project:**

   ```bash
   cd /path/to/your/react/project
   
   # Add the script tag to your HTML (if using unpkg)
   # <script src="//unpkg.com/@react-debugger/core/dist/index.js"></script>
   
   # OR for local testing, serve the built files
   # <script src="http://localhost:8080/index.js"></script>
   
   # Start your React dev server (in one terminal)
   npm run dev  # or yarn dev, usually runs on localhost:3000 or localhost:5173
   
   # In another terminal, start the debugger
   npx @react-debugger/core localhost:3000  # or your app's port (e.g., localhost:5173)
   ```

5. **What should happen:**
   - Chrome opens with debugging flags enabled
   - The debugger window opens at `http://127.0.0.1:5679/debugger`
   - You should see "Debugger widget initialized" in the logs
   - WebSocket connection to Chrome DevTools Protocol establishes
   - React components are tracked and logged as they render
   - Component highlighting and inspection should work in your React app

6. **Clean up when done:**

   ```bash
   sudo npm uninstall -g @react-debugger/core
   ```

### Important Notes for Local Testing

- **Path Resolution Fix**: The CLI uses runtime path resolution to find the debugger server and widget files. This was a critical fix to make the global installation work correctly.
- **Port Requirements**: 
  - Your React app runs on its port (usually 3000 or 5173)
  - Debugger server runs on port 5679
  - Chrome debugging runs on port 9222
- **Chrome Setup**: Ensure Chrome is running with `--remote-debugging-port=9222` (the CLI handles this automatically)
- **Script Tag**: The overlay script can be loaded from unpkg in production or served locally for testing

## Testing the published package experience

For testing how the package works when published to npm:

1. **Build everything:**

   ```bash
   bun run build
   ```

2. **Test the CLI directly (bypasses npm):**

   ```bash
   bun dist/cli.js localhost:5173
   ```

3. **Test the script tag locally (simulates unpkg):**

   ```bash
   # Serve the files - this simulates unpkg CDN
   bunx serve dist --cors -p 8080

   # Add to your test app's HTML
   <script src="http://localhost:8080/index.js"></script>
   ```

4. **Verify the complete workflow:**
   - Overlay script loads and initializes
   - Debugger server starts and serves widget correctly  
   - WebSocket proxy connects to Chrome DevTools Protocol
   - React components are tracked and breakpoints work
   - Component inspection and highlighting functions properly

## Debugging Tips

- **ENOENT Errors**: If you see "no such file or directory" errors for `debugger-widget.js`, ensure you've built the project and are running the globally installed version (not source files)
- **Path Resolution**: The CLI uses runtime path resolution (`fileURLToPath` + `path.dirname`) to correctly locate built files when installed globally
- **Port Conflicts**: If port 5679 is in use, kill the process with `lsof -ti:5679 | xargs kill -9`
- **Browser Console**: Check browser console for errors when the overlay doesn't appear
- **Chrome DevTools**: Ensure Chrome is running with `--remote-debugging-port=9222`
- **WebSocket Connection**: Look for "WebSocket proxy connection opened" and "Connected to CDP WebSocket" in the debugger server logs
- **Component Tracking**: You should see logs like "Component [Name] rendered" if React component tracking is working
- **Script Loading**: Verify the overlay script loads without errors (check Network tab)

## Troubleshooting Common Issues

### "debugger-widget.js not found" Error
This usually means:
1. The project wasn't built (`bun run build`)
2. You're running from source instead of the global installation
3. Path resolution is broken (should be fixed in v0.0.7+)

### Debugger Window Won't Open
1. Check if popup blockers are enabled
2. Verify the debugger server is running on port 5679
3. Try opening `http://127.0.0.1:5679/debugger` manually

### No Component Highlighting
1. Ensure the overlay script is loaded in your React app
2. Check that React DevTools hooks are available
3. Verify WebSocket connection is established

## Publishing

```bash
npm publish --access public
```
