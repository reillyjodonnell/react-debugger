# React Debugger

🚀 **Plug-and-play overlay for React apps. Instantly see logs and errors in your browser!**

---

## 🛠️ How to Use (Local Dev, Current State)

1. **Build the overlay client**

   ```bash
   bun build src/index.ts --outdir dist --target browser --format esm --minify
   ```

   - This creates `dist/index.js` (the overlay client bundle).

2. **Add the overlay to your app**

   - **Option A: Vite alias** (recommended for local dev)
     In your app's `vite.config.ts`:
     ```ts
     import { defineConfig } from 'vite';
     import path from 'path';
     export default defineConfig({
       resolve: {
         alias: {
           'react-debugger': path.resolve(__dirname, '../dist/index.js'),
         },
       },
     });
     ```
     Then in your app's entry point:
     ```js
     import 'react-debugger';
     ```
   - **Option B: Direct import**
     ```js
     import '../path/to/react-debugger/dist/index.js';
     ```

3. **Start Chrome with remote debugging**

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
   ```

   - (You MUST use this Chrome instance to view your app!)

4. **Start the debug server** (in a separate terminal)

   ```bash
   bun run src/debug-server.ts
   ```

   - You should see: `React Debugger server running!` and no errors.

5. **Start your app as usual**

   ```bash
   npm run dev
   # or
   bun dev
   # or whatever you use
   ```

6. **Open your app in the special Chrome** (the one you started in step 3)
   - You should see the React Debugger overlay in the top right!
   - Logs and errors will appear in real time.

---

## 🧠 Reminders

- **The debug server and your app are separate processes.**
- **The overlay only works in the Chrome you started with remote debugging!**
- If you see "No page target found", make sure Chrome is running and your app is open in a tab.
- You can run both servers in two terminals, or automate with a script if you want.

---

## 🏗️ For Development

- All code is in `src/`.
- To build the overlay for browser use:
  ```bash
  bun build src/index.ts --outdir dist --target browser --format esm --minify
  ```
- To run the debug server:
  ```bash
  bun run src/debug-server.ts
  ```

---

## 🏁 That's it!

- One import, one overlay, instant logs. 🎉
- Works with any React app, any build tool (with a little alias help).
- For questions or improvements, check the code or open an issue!

---

MIT
