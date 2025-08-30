#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';
import net from 'net';

// Get the directory of this script at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

const argv = process.argv.slice(2);

// Subcommands & flags
const subcommand = argv.find((a) => !a.startsWith('-')) || ''; // e.g. 'init', 'mcp', or a URL
const isInit = subcommand === 'init';
const isMcpSubcommand = subcommand === 'mcp';
const isMcpModeFlag = argv.includes('--mcp');
const isMcpServerModeFlag = argv.includes('--mcp-server');

const portFlagIndex = argv.findIndex((a) => a === '--port' || a === '-p');
const wsPort = portFlagIndex > -1 ? Number(argv[portFlagIndex + 1]) : 5679;

// Target URL logic (for human/debugger mode)
const urlArg = isInit || isMcpSubcommand ? undefined : subcommand;
const targetUrl = urlArg || 'localhost:3000';

// Derived booleans
const isMcpServerMode = isMcpSubcommand || isMcpServerModeFlag;
const isMcpMode = isMcpModeFlag || isMcpServerMode; // treat 'mcp' as MCP mode as well

async function main() {
  if (isInit) {
    await runInit();
    return;
  }

  if (isMcpServerMode) {
    // Check port availability BEFORE starting server
    const free = await isPortAvailable(wsPort);
    if (!free) {
      console.error(
        `❌ Port ${wsPort} is already in use. Please stop the other process or run with --port <free-port>.`
      );
      process.exit(1);
    }

    // In MCP server mode, redirect logs to stderr (keep stdout clean for JSON-RPC over stdio if used)
    console.error('🤖 Starting React Debugger MCP Server...');
    console.error(
      `📡 MCP server will be available via ${'STDIO'}${
        wsPort ? ` (WS fallback ws://localhost:${wsPort})` : ''
      }`
    );

    const { startMcpServer } = await import('./mcp-server');
    await startMcpServer(wsPort);
    return;
  }

  if (isMcpMode) {
    console.log('🤖 Starting React Debugger in MCP mode...');
    console.log(
      `🔗 MCP WebSocket endpoint (for bridge client): ws://localhost:${wsPort}/mcp`
    );
  } else {
    console.log('🚀 Starting React Debugger...');
  }

  // Extract port from target URL (fallback 3000)
  const port = targetUrl.includes(':') ? targetUrl.split(':')[1] : '3000';

  // 2) Start debugger server in background with target port and mode
  const args = [path.join(__dirname, 'debugger-server.js'), port];
  if (isMcpMode) args.push('--mcp');

  const server = spawn('bun', args.filter(Boolean) as string[], {
    stdio: 'inherit',
    detached: true,
  });

  // 3) Give server a moment to boot
  await delay(1000);

  if (!isMcpMode) {
    // 4) Launch Chrome with debugging (only in human mode)
    await launchChrome(`http://${targetUrl}`);
  } else {
    console.log('💡 Add this script tag to your React app:');
    console.log(
      `<script src="http://localhost:${wsPort}/react-bridge-client.js"></script>`
    );
  }

  // 5) Keep process alive; clean up on SIGINT
  process.on('SIGINT', () => {
    if ('kill' in server && typeof server.kill === 'function') {
      server.kill();
    }
    process.exit();
  });
}

/* -------------------------- init subcommand -------------------------- */

async function runInit() {
  const cwd = process.cwd();

  console.log('🧰 react-debugger init');
  console.log('• Detecting project tooling and writing config...');

  // Always write/merge project-scoped .mcp.json at repo root
  const rootMcpPath = path.join(cwd, '/.cursor/mcp.json');
  mergeMcpConfig(rootMcpPath, {
    mcpServers: {
      'react-debugger': {
        command: 'npx',
        args: ['-y', 'react-debugger', 'mcp', '--port', String(5679)],
      },
    },
  });
  console.log(`  ✔ Wrote ${rel(rootMcpPath)}`);

  // Cursor: if .cursor exists, write rule + (optional) per-project MCP too
  const cursorDir = path.join(cwd, '.cursor');
  if (existsSync(cursorDir)) {
    const rulesDir = path.join(cursorDir, 'rules');
    mkdirp(rulesDir);
    const rulePath = path.join(rulesDir, 'react-debugger.md');
    writeIfAbsent(rulePath, cursorRuleMarkdown());
    console.log(`  ✔ Added Cursor rule ${rel(rulePath)}`);

    // Some Cursor setups also read project .mcp.json; ensure it exists (already wrote root)
    console.log(
      '  ✔ Cursor detected (.cursor). MCP is project-scoped via .mcp.json'
    );
  } else {
    console.log('  ○ No .cursor/ directory found (skipping Cursor rule)');
  }

  // VS Code: if .vscode exists, write a mirrored MCP file to help Copilot/others discover it
  const vscodeDir = path.join(cwd, '.vscode');
  if (existsSync(vscodeDir)) {
    const vscodeMcpPath = path.join(vscodeDir, 'mcp.json');
    mergeMcpConfig(vscodeMcpPath, {
      mcpServers: {
        'react-debugger': {
          command: 'npx',
          args: ['-y', 'react-debugger', 'mcp', '--port', String(5679)],
        },
      },
    });
    console.log(`  ✔ Wrote ${rel(vscodeMcpPath)}`);
  } else {
    console.log('  ○ No .vscode/ directory found (skipping VS Code MCP file)');
  }

  console.log('\n✅ Init complete.');
  console.log('Next steps:');
  console.log('  1) Start the server locally with: npx react-debugger mcp');
  console.log(
    '  2) In your app, add: <script src="//unpkg.com/@react-debugger/core/dist/react-bridge-client.js"></script>'
  );
}

/* -------------------------- helpers -------------------------- */

function cursorRuleMarkdown(): string {
  return `
---
description: 'Enforce diagnostic-first workflow using React Debugger MCP'
globs:
  - '**/*'
alwaysApply: true
---

When you are helping debug React bugs, follow this workflow:

1. **Diagnose before editing.**
2. **Do not** propose or change code before using the React Debugger tools:
   - \`tools/call subscribe\` → capture \`fid\`
   - \`tools/call nextEvents\` → wait for snapshot/commit
   - \`tools/call getProps\` or \`tools/call getHooksState\` using that \`fid\`
3. Only **after** stating your diagnosis, backed by evidence, may you propose code changes.
`;
}

function mergeMcpConfig(filePath: string, addition: Record<string, any>) {
  mkdirp(path.dirname(filePath));
  let data: any = {};
  if (existsSync(filePath)) {
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      // If corrupted or empty, start fresh
      data = {};
    }
  }
  // shallow merge mcpServers node
  data.mcpServers = {
    ...(data.mcpServers || {}),
    ...(addition.mcpServers || {}),
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function writeIfAbsent(filePath: string, content: string) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf8');
  }
}

function mkdirp(dirPath: string) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function rel(p: string) {
  return path.relative(process.cwd(), p) || '.';
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

// Try different Chrome variants
async function findChrome(): Promise<string> {
  const chromeCommands = ['google-chrome', 'chromium', 'chrome'];

  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  // First try commands in PATH
  for (const cmd of chromeCommands) {
    try {
      const { stdout } = await execAsync(`which ${cmd}`);
      if (stdout.trim()) {
        return stdout.trim();
      }
    } catch {
      // Command not found, try next
    }
  }

  // Then try full paths
  for (const p of chromePaths) {
    try {
      if (existsSync(p)) {
        return p;
      }
    } catch {
      // Path not found, try next
    }
  }

  throw new Error('Chrome not found');
}

async function launchChrome(url: string) {
  const chromePath = await findChrome();

  // Launch Chrome with debugging flags
  spawn(
    chromePath,
    ['--remote-debugging-port=9222', '--user-data-dir=/tmp/chrome-debug', url],
    {
      stdio: 'inherit',
      detached: true,
    }
  );
}

main().catch((err) => {
  console.error('Error starting React Debugger:', err);
  process.exit(1);
});
