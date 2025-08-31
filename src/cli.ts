#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';
import net from 'net';
import readline from 'readline';

// Simple ANSI color helpers (no external deps)
const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

// Get the directory of this script at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

const argv = process.argv.slice(2);

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'mcp.json');

// Subcommands & flags
const subcommand = argv.find((a) => !a.startsWith('-')) || ''; // e.g. 'init', 'mcp', 'overlay', or a URL
const isInit = subcommand === 'init';
const isMcpServerMode = subcommand === 'mcp';
const isHelp = subcommand === 'help';

const portFlagIndex = argv.findIndex((a) => a === '--port' || a === '-p');
const wsPort = portFlagIndex > -1 ? Number(argv[portFlagIndex + 1]) : 5679;

// Optional explicit client flags to tailor messaging and behavior
const flagCursor = argv.includes('--cursor');
const flagVscode = argv.includes('--vscode');
const flagClaude = argv.includes('--claude');

// Target URL logic (for human/debugger mode)
// If a recognized subcommand (init|mcp|overlay) was provided, the target URL
// may be the NEXT positional argument. Otherwise, treat the subcommand itself
// as the target URL (backwards compatibility with the older CLI).
let urlArg: string | undefined;
if (isInit || isMcpServerMode) {
  const idx = argv.indexOf(subcommand);
  urlArg = argv[idx + 1];
} else {
  urlArg = subcommand;
}
const targetUrl = urlArg || 'localhost:3000';

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

  if (isHelp) {
    await runHelpInteractive();
    return;
  }
}

/* -------------------------- init subcommand -------------------------- */

function loadMcpTemplate(): any {
  try {
    if (existsSync(TEMPLATE_PATH)) {
      const raw = readFileSync(TEMPLATE_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    console.error('Failed to load MCP template');
  }
  return { mcpServers: {} };
}
function findMcpTargetsInProject(cwd: string): string[] {
  const candidates = [
    path.join(cwd, '.cursor', 'mcp.json'),
    path.join(cwd, 'mcp.json'),
  ];
  return candidates.filter((p) => existsSync(p));
}

async function runInit() {
  const cwd = process.cwd();

  // 1) Ensure Cursor rule first
  const cursorDir = path.join(cwd, '.cursor');
  mkdirp(cursorDir);
  const rulesDir = path.join(cursorDir, 'rules');
  mkdirp(rulesDir);
  const rulePath = path.join(rulesDir, 'react-debugger.md');
  writeIfAbsent(rulePath, cursorRuleMarkdown());
  console.log(`  ✔ Ensured Cursor rule ${rel(rulePath)}`);

  // 2) Ensure MCP config from template (non-destructive)
  const serverId = 'react-debugger';
  const template = loadMcpTemplate();
  const serverConfig = template?.mcpServers?.[serverId];
  if (!serverConfig) {
    throw new Error(`Template is missing "${serverId}" definition`);
  }

  const existingTargets = findMcpTargetsInProject(cwd);
  if (existingTargets.length === 0) {
    const defaultPath = path.join(cwd, '.cursor', 'mcp.json');
    mkdirp(path.dirname(defaultPath));
    ensureMcpServer(defaultPath, serverId, serverConfig, template);
    console.log(`  ✔ Created ${rel(defaultPath)} and added ${serverId}`);
  } else {
    for (const filePath of existingTargets) {
      mkdirp(path.dirname(filePath));
      const res = ensureMcpServer(filePath, serverId, serverConfig, template);
      if (res.added) {
        console.log(`  ✔ Added ${serverId} to ${rel(filePath)}`);
      }
    }
  }

  // 3) Detect framework and inject the bridge <script> into <head>
  const injectRes = detectAndInjectBridge(cwd);
  if (injectRes.injected) {
    console.log(
      `  ✔ Detected ${injectRes.detected} and injected bridge into ${rel(
        injectRes.filePath!
      )}`
    );
  } else if (injectRes.detected) {
    console.log(
      `  ○ Detected ${injectRes.detected} but couldn't auto-inject (${
        injectRes.reason ?? 'no <head> tag found'
      }).`
    );
    console.log('    Add this to your <head>:');
    console.log(`    ${BRIDGE_TAG}`);
  } else {
    console.log(
      '  ○ Could not detect framework. Add this to your <head> manually:'
    );
    console.log(`    ${BRIDGE_TAG}`);
  }

  console.log('\n✅ Init complete.');

  // Summarize succinctly
  const added: string[] = [];
  // Cursor rule always added/ensured
  added.push('.cursor/rules/react-debugger.md');

  // mcp.json targets
  const targets = findMcpTargetsInProject(cwd);
  if (targets.length === 0) {
    added.push('.cursor/mcp.json');
  } else {
    for (const filePath of targets) added.push(rel(filePath));
  }

  // Bridge injection
  const injectRes2 = detectAndInjectBridge(cwd);
  const frameworkLabel = injectRes2.detected || 'your project';
  if (injectRes2.injected) {
    added.push(`bridge injected into ${rel(injectRes2.filePath!)}`);
  }

  const detectedClient = detectClientFromProject(cwd);
  const requestedClient = flagCursor
    ? 'cursor'
    : flagVscode
    ? 'vscode'
    : flagClaude
    ? 'claude'
    : null;
  const clientToShow = requestedClient || detectedClient || 'your editor';

  console.log(
    '\n' +
      ANSI.bold +
      'Initializing react debugger for ' +
      ANSI.reset +
      ANSI.cyan +
      frameworkLabel +
      ANSI.reset +
      ANSI.bold +
      ' with ' +
      ANSI.reset +
      ANSI.cyan +
      clientToShow +
      ANSI.reset +
      '\n'
  );

  if (added.length > 0) {
    console.log(ANSI.bold + 'added:' + ANSI.reset);
    for (const it of added) console.log(ANSI.green + '- ' + ANSI.reset + it);
    console.log('');
  }

  printClientInstructions(
    clientToShow === 'your editor' ? 'generic' : clientToShow
  );

  console.log('');
  console.log(
    ANSI.dim + 'Need help? `npx @react-debugger/core help`' + ANSI.reset
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

function writeIfAbsent(filePath: string, content: string) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf8');
  }
}

const BRIDGE_SRC =
  '//unpkg.com/@react-debugger/core/dist/react-bridge-client.js';
const BRIDGE_TAG = `<script src="${BRIDGE_SRC}"></script>`;

type InjectResult = {
  detected: string | null;
  filePath: string | null;
  injected: boolean;
  reason?: string;
};

function detectAndInjectBridge(cwd: string): InjectResult {
  const candidates: Array<{
    framework: string;
    kind: 'html' | 'tsx';
    files: string[];
  }> = [
    // Next.js App Router: layout returns <html>...</html> and often omits <head>
    {
      framework: 'Next.js (app router)',
      kind: 'tsx',
      files: [
        path.join(cwd, 'app', 'layout.tsx'),
        path.join(cwd, 'app', 'layout.jsx'),
        path.join(cwd, 'app', 'layout.js'),
      ],
    },
    // Next.js Pages Router: custom Document with <Html>, <Head>, <Main/>
    {
      framework: 'Next.js (pages router)',
      kind: 'tsx',
      files: [
        path.join(cwd, 'pages', '_document.tsx'),
        path.join(cwd, 'pages', '_document.jsx'),
        path.join(cwd, 'pages', '_document.js'),
      ],
    },
    // Remix: typical root.tsx returns <html><head>...</head><body>...</body></html>
    {
      framework: 'Remix',
      kind: 'tsx',
      files: [
        path.join(cwd, 'app', 'root.tsx'),
        path.join(cwd, 'app', 'root.jsx'),
        path.join(cwd, 'app', 'entry.server.tsx'), // some templates
      ],
    },
    // Vite / vanilla HTML
    {
      framework: 'Vite/Vanilla HTML',
      kind: 'html',
      files: [
        path.join(cwd, 'index.html'),
        path.join(cwd, 'public', 'index.html'),
      ],
    },
  ];

  for (const group of candidates) {
    for (const f of group.files) {
      if (!existsSync(f)) continue;
      const ok =
        group.kind === 'html' ? injectIntoHtmlHead(f) : injectIntoTsxHead(f);
      return {
        detected: group.framework,
        filePath: f,
        injected: ok.success,
        reason: ok.reason,
      };
    }
  }
  return {
    detected: null,
    filePath: null,
    injected: false,
    reason: 'no known framework files found',
  };
}

function hasBridge(content: string): boolean {
  // Prefer a stable src check; will also cover minified/pretty changes in tag
  return content.includes(BRIDGE_SRC) || content.includes(BRIDGE_TAG);
}

function injectIntoHtmlHead(filePath: string): {
  success: boolean;
  reason?: string;
} {
  try {
    const raw = readFileSync(filePath, 'utf8');
    if (hasBridge(raw)) return { success: true };

    const RE_HEAD_CLOSE = /<\/head\s*>/i;
    const RE_HEAD_OPEN = /<head\b[^>]*>/i;
    const RE_HTML_OPEN = /<html\b[^>]*>/i;
    const RE_HTML_CLOSE = /<\/html\s*>/i;
    const RE_BODY_OPEN = /<body\b[^>]*>/i;

    let updated = raw;
    let reason = 'inserted before </head>';

    if (RE_HEAD_CLOSE.test(raw)) {
      updated = raw.replace(RE_HEAD_CLOSE, `  ${BRIDGE_TAG}\n</head>`);
    } else if (RE_HEAD_OPEN.test(raw)) {
      updated = raw.replace(RE_HEAD_OPEN, (m) => `${m}\n  ${BRIDGE_TAG}\n`);
      reason = 'inserted after <head>';
    } else if (RE_HTML_OPEN.test(raw)) {
      updated = raw.replace(
        RE_HTML_OPEN,
        (m) => `${m}\n  <head>\n    ${BRIDGE_TAG}\n  </head>\n`
      );
      reason = 'created <head> after <html>';
    } else if (RE_BODY_OPEN.test(raw)) {
      updated = raw.replace(
        RE_BODY_OPEN,
        (m) => `<head>\n  ${BRIDGE_TAG}\n</head>\n${m}`
      );
      reason = 'created <head> before <body>';
    } else if (RE_HTML_CLOSE.test(raw)) {
      updated = raw.replace(
        RE_HTML_CLOSE,
        `  <head>\n    ${BRIDGE_TAG}\n  </head>\n</html>`
      );
      reason = 'created <head> before </html>';
    } else {
      updated = `<head>\n  ${BRIDGE_TAG}\n</head>\n` + raw;
      reason = 'prepended <head> (fallback)';
    }

    writeFileSync(filePath, updated, 'utf8');
    return { success: true, reason };
  } catch {
    return { success: false, reason: 'write failed' };
  }
}

function injectIntoTsxHead(filePath: string): {
  success: boolean;
  reason?: string;
} {
  try {
    const raw = readFileSync(filePath, 'utf8');
    if (hasBridge(raw)) return { success: true };

    // Common TSX shapes across Next/Remix
    const RE_NEXTDOC_HEAD_CLOSE = /<\/Head\s*>/; // Next Document's <Head>…</Head>
    const RE_NEXTDOC_HEAD_SELF = /<Head(\b[^>]*)\/>/; // self-closing <Head />
    const RE_HTML_HEAD_CLOSE = /<\/head\s*>/i; // literal <head>…</head>
    const RE_HTML_HEAD_SELF = /<head(\b[^>]*)\/>/i; // self-closing <head />
    const RE_HTML_OPEN_COMPONENT = /<Html\b[^>]*>/; // Next Document's <Html>
    const RE_HTML_OPEN = /<html\b[^>]*>/i; // literal <html> (App Router / Remix)
    const RE_BODY_OPEN_COMPONENT = /<Body\b[^>]*>/; // uncommon, but seen
    const RE_BODY_OPEN = /<body\b[^>]*>/i;

    let updated = raw;
    let reason = 'inserted in head';

    // 1) Next.js Pages Router: <Head>…</Head>
    if (RE_NEXTDOC_HEAD_CLOSE.test(raw)) {
      updated = raw.replace(RE_NEXTDOC_HEAD_CLOSE, `  ${BRIDGE_TAG}\n</Head>`);
      reason = 'inserted before </Head>';
    }
    // 2) Next.js Pages Router: <Head /> self-closing
    else if (RE_NEXTDOC_HEAD_SELF.test(raw)) {
      updated = raw.replace(
        RE_NEXTDOC_HEAD_SELF,
        (_m, attrs) => `<Head${attrs}>\n  ${BRIDGE_TAG}\n</Head>`
      );
      reason = 'expanded <Head /> and inserted';
    }
    // 3) Literal <head>…</head> inside TSX (Remix root / App Router layout)
    else if (RE_HTML_HEAD_CLOSE.test(raw)) {
      updated = raw.replace(RE_HTML_HEAD_CLOSE, `  ${BRIDGE_TAG}\n</head>`);
      reason = 'inserted before </head>';
    }
    // 4) Self-closing literal <head />
    else if (RE_HTML_HEAD_SELF.test(raw)) {
      updated = raw.replace(
        RE_HTML_HEAD_SELF,
        (_m, attrs) => `<head${attrs}>\n  ${BRIDGE_TAG}\n</head>`
      );
      reason = 'expanded <head /> and inserted';
    }
    // 5) No head present: create one right after <Html> (Next Document)
    else if (RE_HTML_OPEN_COMPONENT.test(raw)) {
      updated = raw.replace(
        RE_HTML_OPEN_COMPONENT,
        (m) => `${m}\n  <Head>\n    ${BRIDGE_TAG}\n  </Head>\n`
      );
      reason = 'created <Head> after <Html>';
    }
    // 6) No head present: create one right after <html> (App Router / Remix)
    else if (RE_HTML_OPEN.test(raw)) {
      updated = raw.replace(
        RE_HTML_OPEN,
        (m) => `${m}\n  <head>\n    ${BRIDGE_TAG}\n  </head>\n`
      );
      reason = 'created <head> after <html>';
    }
    // 7) As a last TSX-specific fallback, create <head> before <Body>/<body>
    else if (RE_BODY_OPEN_COMPONENT.test(raw)) {
      updated = raw.replace(
        RE_BODY_OPEN_COMPONENT,
        (m) => `<Head>\n  ${BRIDGE_TAG}\n</Head>\n${m}`
      );
      reason = 'created <Head> before <Body>';
    } else if (RE_BODY_OPEN.test(raw)) {
      updated = raw.replace(
        RE_BODY_OPEN,
        (m) => `<head>\n  ${BRIDGE_TAG}\n</head>\n${m}`
      );
      reason = 'created <head> before <body>';
    }
    // 8) Truly headless TSX (edge case) — prepend a head block
    else {
      updated = `<head>\n  ${BRIDGE_TAG}\n</head>\n` + raw;
      reason = 'prepended <head> (fallback)';
    }

    writeFileSync(filePath, updated, 'utf8');
    return { success: true, reason };
  } catch {
    return { success: false, reason: 'write failed' };
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

/**
 * Heuristic detection of MCP client from project files.
 * Returns one of: 'cursor', 'vscode', 'claude', or null.
 */
function detectClientFromProject(cwd: string): string | null {
  try {
    // Cursor often has a .cursor directory
    if (existsSync(path.join(cwd, '.cursor'))) return 'cursor';

    // VS Code projects often have a .vscode directory or package.json with mcp extension devDependency
    if (existsSync(path.join(cwd, '.vscode'))) return 'vscode';

    const pkgPath = path.join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8') || '{}');
      const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
      if (deps && typeof deps === 'object') {
        if (deps['@cursor/dev'] || deps['@cursor/cli']) return 'cursor';
        if (deps['@microsoft/vscode-mcp'] || deps['vscode']) return 'vscode';
        if (deps['claude-desktop'] || deps['anthropic']) return 'claude';
      }
    }
  } catch {
    // ignore detection errors
  }
  return null;
}

function printClientInstructions(client: string) {
  const lines: string[] = [];
  switch (client) {
    case 'cursor':
      lines.push(
        ANSI.green +
          '• ' +
          ANSI.reset +
          ANSI.bold +
          'Cursor detected.' +
          ANSI.reset +
          ' After enabling the MCP server you should see a popup:'
      );
      lines.push(
        ANSI.dim +
          '    `New MCP server detected: react-debugger` → click "Enable".' +
          ANSI.reset
      );
      lines.push(
        ANSI.dim +
          '  If the popup did not appear, go to Settings → MCP & Integrations → MCP Tools and toggle on `react-debugger`.' +
          ANSI.reset
      );
      break;
    case 'vscode':
      lines.push(
        ANSI.green +
          '• ' +
          ANSI.reset +
          ANSI.bold +
          'VS Code detected.' +
          ANSI.reset +
          ' Enable the server in the MCP extension:'
      );
      lines.push(
        ANSI.dim +
          '    Open the Command Palette → Manage MCP Servers. Add or enable `react-debugger`.' +
          ANSI.reset
      );
      break;
    case 'claude':
      lines.push(
        ANSI.green +
          '• ' +
          ANSI.reset +
          ANSI.bold +
          'Claude Desktop detected.' +
          ANSI.reset +
          ' You should see a popup:'
      );
      lines.push(
        ANSI.dim +
          '    `New MCP server detected: react-debugger` → click "Enable".' +
          ANSI.reset
      );
      lines.push(
        ANSI.dim +
          '  If it does not appear, go to Settings → MCP Servers and toggle on `react-debugger`.' +
          ANSI.reset
      );
      break;
    default:
      lines.push(
        ANSI.green +
          '• ' +
          ANSI.reset +
          ANSI.bold +
          'MCP server created.' +
          ANSI.reset +
          ' To enable it in your environment, refer to the README for client-specific steps.'
      );
      lines.push(
        ANSI.dim +
          '  For a quick local run you can start the MCP server with:' +
          ANSI.reset
      );
      lines.push(ANSI.dim + '    npx @react-debugger/core mcp' + ANSI.reset);
      break;
  }

  for (const l of lines) console.log(l);
}

async function runHelpInteractive() {
  if (!process.stdin.isTTY) {
    console.log(
      'Help is interactive. Run this command in a terminal: npx @react-debugger/core help'
    );
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const opts = [
    'MCP server problems',
    'Problems with mcp.json',
    'Cursor rules / diagnostics',
    'Exit',
  ];

  console.log(`${ANSI.bold}${ANSI.cyan}React Debugger — Help${ANSI.reset}`);
  console.log('Choose a topic to get troubleshooting steps:\n');
  opts.forEach((o, i) =>
    console.log(`  ${ANSI.yellow}${i + 1}${ANSI.reset}) ${o}`)
  );

  const q = (prompt: string) =>
    new Promise<string>((res) => rl.question(prompt, res));
  const ans = await q('\nSelect (1-4): ');
  const idx = Number(ans.trim()) - 1;

  console.log('');
  switch (idx) {
    case 0:
      console.log(`${ANSI.bold}MCP server problems${ANSI.reset}`);
      console.log(`• Is port ${ANSI.green}5679${ANSI.reset} in use? Free it:`);
      console.log(`    ${ANSI.dim}lsof -ti:5679 | xargs kill -9${ANSI.reset}`);
      console.log('• Start the server with an explicit port if needed:');
      console.log('    npx @react-debugger/core mcp --port 5680');
      console.log(
        '• Check logs in the terminal where the MCP server was started for errors.'
      );
      break;
    case 1:
      console.log(`${ANSI.bold}Problems with mcp.json${ANSI.reset}`);
      console.log(
        '• Ensure there is an `mcp.json` in your project or .cursor/mcp.json.'
      );
      console.log(
        '• Validate JSON formatting — a trailing comma will break the file.'
      );
      console.log(
        '• If missing, run `npx @react-debugger/core init` to seed it.'
      );
      break;
    case 2:
      console.log(`${ANSI.bold}Cursor rules / diagnostics${ANSI.reset}`);
      console.log(
        '• Ensure `.cursor/rules/react-debugger.md` exists (init creates it).'
      );
      console.log(
        '• Cursor may require you to enable MCP tools in Settings → MCP & Integrations → MCP Tools.'
      );
      console.log(
        "• If rules aren't applied, try restarting Cursor or reload the window (Cmd/Ctrl+Shift+P → Reload Window)."
      );
      break;
    default:
      console.log('Exiting help.');
      break;
  }

  rl.close();
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

// --- MCP config helpers ------------------------------------------------------

function readJsonSafe(filePath: string): any {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    // Corrupt? start fresh rather than crash.
    return {};
  }
}

function writeJsonStable(filePath: string, obj: any) {
  try {
    mkdirp(path.dirname(filePath));
    writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error(`Failed to write MCP config to ${filePath}:`, err);
    throw err;
  }
}

/**
 * Ensures an MCP server entry exists in `filePath` without clobbering other servers.
 * - Creates file from template if missing.
 * - Adds the `serverId` if absent.
 * - If present, leaves existing config untouched (no surprise overwrites).
 */
function ensureMcpServer(
  filePath: string,
  serverId: string,
  serverConfig: Record<string, any>,
  templateObj?: Record<string, any>
) {
  const hadFile = existsSync(filePath);

  // If no file, start from the template wholesale; otherwise read existing.
  let base: any = hadFile
    ? readJsonSafe(filePath)
    : templateObj && typeof templateObj === 'object'
    ? JSON.parse(JSON.stringify(templateObj))
    : {};
  if (!base || typeof base !== 'object') base = {};

  // If we *do* have an existing file, merge in any missing top-level keys from the template (non-destructive).
  if (hadFile && templateObj && typeof templateObj === 'object') {
    for (const [k, v] of Object.entries(templateObj)) {
      if (k === 'mcpServers') continue; // handled below
      if (!(k in base)) base[k] = v;
    }
  }

  if (!base.mcpServers || typeof base.mcpServers !== 'object')
    base.mcpServers = {};

  const hadServer = !!base.mcpServers[serverId];
  if (!hadServer) {
    base.mcpServers[serverId] = serverConfig;
  }

  // Write if the file didn't exist (seed from template) or if we added the server.
  if (!hadFile || !hadServer) {
    writeJsonStable(filePath, base);
  }

  return { added: !hadServer, updated: false };
}
