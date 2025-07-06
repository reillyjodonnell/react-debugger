# React Debugger

🚀 **Plug-and-play overlay for React apps. Instantly see logs and errors in your browser!**

## Architecture

- **Main App**: Your React app runs as usual.
- **Canvas Overlay**: A full-screen, non-interactive canvas is injected into the main document for highlighting and overlays.
- **Widget UI**: The debugger widget is rendered in a floating, dynamically-sized iframe, loaded from a cross-origin server.
- **Widget Server**: A Bun server (`src/debugger-server.ts`) serves `debugger.html` and the widget React entry (`src/debugger-widget.tsx`) on port 5679.

## Setup

1. **Install dependencies** (if you haven't already):

   ```sh
   bun install
   ```

2. **Start Chrome with remote debugging**:

   ```sh
   bun run chrome
   ```

   This opens Chrome with remote debugging enabled on port 9222. **You MUST use this Chrome instance to view your app!**

3. **Build the debugger and start the server**:

   ```sh
   bun run build && bun run src/debugger-server.ts
   ```

   This builds the debugger widget and starts the server on port 5679.

4. **Start the example app**:

   ```sh
   cd example && bun run dev
   ```

   This starts the example React app on port 5173.

5. **Open the example app in the special Chrome** (the one you started in step 2):
   - Navigate to `http://localhost:5173`
   - You should see the React Debugger overlay in the top right!
   - The debugger widget will show logs, breakpoints, and component inspection.

## Usage

- **Toggle debugger**: Press `Ctrl+Shift+D` or click the debugger widget
- **Add breakpoints**: Click the "Add Breakpoint" button, then click on components in your app
- **Inspect components**: When a breakpoint is hit, the inspector panel shows component props, state, and hooks
- **Debug controls**: Use Resume (▶) and Step Over (⏯) buttons when paused at breakpoints

## Scripts

The project includes several convenience scripts:

- `bun run chrome` - Start Chrome with remote debugging enabled
- `bun run build` - Build the debugger widget
- `bun run src/debugger-server.ts` - Start the debugger server
- `bun run start-all.sh` - Run all commands in sequence (Chrome, build, server, example app)

---

## 🛠️ How to Use (Local Dev, Current State)

The React Debugger is now a complete debugging solution with:

- **Component highlighting** - Click components to see their source location
- **Breakpoint management** - Set breakpoints on components and pause execution
- **Live inspection** - View component props, state, and hooks when paused
- **Debug controls** - Resume and step through code execution

### Quick Start

1. **Start Chrome with remote debugging**:

   ```bash
   bun run chrome
   ```

2. **Build and start the debugger server**:

   ```bash
   bun run build && bun run src/debugger-server.ts
   ```

3. **Start the example app**:

   ```bash
   cd example && bun run dev
   ```

4. **Open `http://localhost:5173` in the special Chrome instance**

### Adding to Your Own App

1. **Build the debugger**:

   ```bash
   bun run build
   ```

2. **Add the overlay to your app**:

   ```js
   import 'react-debugger';
   ```

3. **Start Chrome with remote debugging**:

   ```bash
   bun run chrome
   ```

4. **Start the debugger server**:

   ```bash
   bun run src/debugger-server.ts
   ```

5. **Start your app and open it in the special Chrome instance**

---

## 🧠 Reminders

- **The debugger server and your app are separate processes.**
- **The debugger only works in the Chrome you started with remote debugging!**
- If you see "No page target found", make sure Chrome is running and your app is open in a tab.
- The debugger widget is always expanded to accommodate the inspector panel.
- When a breakpoint is hit, the entire JavaScript context pauses, so the widget becomes unresponsive until you resume execution.

---

## 🏗️ For Development

- All code is in `src/`.
- The debugger widget is in `src/debugger-widget.tsx`
- The overlay client is in `src/index.tsx`
- The server is in `src/debugger-server.ts`
- To build the debugger widget:
  ```bash
  bun run build
  ```
- To run the debugger server:
  ```bash
  bun run src/debugger-server.ts
  ```

---

## 🏁 That's it!

- One import, one overlay, instant logs. 🎉
- Works with any React app, any build tool (with a little alias help).
- For questions or improvements, check the code or open an issue!

---

MIT
