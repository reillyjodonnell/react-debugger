# React Debugger

Supercharge agents with React runtime values.

> ⚠️ Alpha. APIs subject to change.

## Why

AI agents are good at guessing. They can read your codebase, suggest edits, and point you in the right direction.

But they can’t see what’s _actually_ happening in your running app. That’s the missing piece.

React Debugger bridges that gap. It connects your React runtime to MCP-enabled agents (Cursor, Claude, VSCode, etc.), so they can inspect live components, props, and state — the same way you would in devtools.

This turns agents from **helpful advisors** into **practical debuggers**.

## Quickstart

1. Initialize the project (creates Cursor rule + MCP config):

```
npx @react-debugger/core init
```

Tip: to avoid getting a cached/older package from the registry, you can force the latest published version with:

```
npx @react-debugger/core@latest init
```

2. Enable the MCP server in your environment:

- Cursor: you should see a popup `New MCP server detected: react-debugger` → click "Enable". If not, open Settings → MCP & Integrations → MCP Tools and toggle `react-debugger`.
- Claude Desktop: look for the same popup or enable in Settings → MCP Servers.
- VS Code: open the Command Palette → Manage MCP Servers → Add or enable `react-debugger` (requires the MCP extension).
- Other: start locally with `npx @react-debugger/core mcp`.

If you've just run `init`, the CLI prints a short summary showing what was added and a single line with the most likely next step for your editor.

Need guided troubleshooting? Run:

```
npx @react-debugger/core help
```

This opens an interactive, terminal-only help menu with fixes for common problems (MCP server port conflicts, `mcp.json` issues, Cursor rules not applying).

## What you get

- **Agents with context**  
  They don’t just guess — they can tell you exactly why your button isn’t clickable, or why a prop isn’t updating.

- **Faster debugging**  
  “This component has disabled={true} because it’s inheriting state from X.” → Answers that normally take you 10–20 minutes to track down.

## Requirements

- React 16.8+
- Chrome (for debugging)
- bun (`npm i -g bun`)
