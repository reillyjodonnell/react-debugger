#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import readline from 'readline';
import net from 'net';

// Simple ANSI color helpers (no external deps)
// Keep only three strong colors: green (success), yellow (warnings), cyan (headings/accents).
// Use dim for secondary/auxiliary text. Underline is reserved for copy-paste snippets only.
const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  underline: '\u001b[4m',

  green: '\u001b[32m', // success
  yellow: '\u001b[33m', // warnings
  cyan: '\u001b[36m', // accents / headings
  gray: '\u001b[90m', // secondary text (use dim for FYI)
  red: '\u001b[31m', // errors
};

// Bridge tag used when injecting into HTML/TSX
const BRIDGE_SRC =
  '//unpkg.com/@react-debugger/core/dist/react-bridge-client.js';
const BRIDGE_TAG = `<script src="${BRIDGE_SRC}"></script>`;

// Result shape for detectAndInjectBridge
interface InjectResult {
  detected: string | null;
  filePath: string | null;
  injected: boolean;
  reason?: string;
}

// Get the directory of this script at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = process.argv.slice(2);

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'mcp.json');

// Subcommands & flags
const subcommand = argv.find((a) => !a.startsWith('-')) || ''; // e.g. 'init', 'mcp', 'overlay', or a URL

const portFlagIndex = argv.findIndex((a) => a === '--port' || a === '-p');
const wsPort = portFlagIndex > -1 ? Number(argv[portFlagIndex + 1]) : 5679;

const cwd = process.cwd();

const handleInit = async () => {
  const injectRes = detectAndInjectBridge(cwd);
  if (injectRes.injected) {
    console.log(
      `  ${ANSI.green}✔${ANSI.reset} Detected ${ANSI.cyan}${
        injectRes.detected
      }${ANSI.reset} and injected bridge into ${ANSI.gray}${rel(
        injectRes.filePath!
      )}${ANSI.reset}`
    );
    console.log('');
  } else if (injectRes.detected) {
    console.log(
      `  ${ANSI.yellow}⚠${ANSI.reset} Detected ${ANSI.cyan}${
        injectRes.detected
      }${ANSI.reset} but couldn't auto-inject (${ANSI.gray}${
        injectRes.reason ?? 'no <head> tag found'
      }${ANSI.reset}).`
    );
  } else {
    console.log(`${ANSI.yellow}⚠ No framework detected.${ANSI.reset}`);
    console.log('');
    console.log(
      `  Add this to your <head> (e.g., index.html or app.html):${ANSI.reset}`
    );
    console.log(`  ${ANSI.cyan}${BRIDGE_TAG}${ANSI.reset}`);
    console.log('');
  }

  // find what client we are going to init
  const clientTypes = ['cursor', 'claude'];
  const passedClient = clientTypes.find((type) => argv.includes(`--${type}`));
  if (passedClient) {
    // init specific client
    switch (passedClient) {
      case 'cursor':
        initCursor();
        return;

      case 'claude':
        await initClaudeCode();
        return;
    }
  }
  console.log(`${ANSI.bold}Select your MCP client:${ANSI.reset}`);
  const labels = ['Cursor', 'Claude code'];

  console.log(`  ${ANSI.cyan}1${ANSI.reset}) ${labels[0]}`);
  console.log(`  ${ANSI.cyan}2${ANSI.reset}) ${labels[1]}`);

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ans = await new Promise<string>((res) =>
      rl.question(`\n${ANSI.bold}Choose (1–2): ${ANSI.reset}`, res)
    );
    rl.close();
    const choice = (ans || '').trim();
    const mcpClient = labels[parseInt(choice) - 1];
    console.log('');
    switch (mcpClient) {
      case 'Cursor':
        initCursor();
        break;
      case 'VSCode':
        initVSCode();
        break;
      case 'Claude code':
        await initClaudeCode();
        break;
    }
  }
};

const initCursor = () => {
  console.log('Initializing Cursor...');
  const cursorDir = path.join(cwd, '.cursor');
  mkdirp(cursorDir);
  const rulesDir = path.join(cursorDir, 'rules');
  mkdirp(rulesDir);
  const rulePath = path.join(rulesDir, 'react-debugger.mdc');
  const hadRule = existsSync(rulePath);

  if (!existsSync(rulePath)) {
    writeFileSync(rulePath, cursorRuleMarkdown(), 'utf8');
  }
  if (hadRule) {
    console.log(`${ANSI.gray}  • Already configured: ${rel(rulePath)}`);
  } else {
    console.log(`  ✔ Created: ${rel(rulePath)}`);
  }

  const defaultPath = path.join(cwd, '.cursor', 'mcp.json');
  mkdirp(path.dirname(defaultPath));
  const serverId = 'react-debugger';
  const mcpTemplateFile = existsSync(TEMPLATE_PATH)
    ? JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'))
    : {};
  const serverConfig = mcpTemplateFile?.mcpServers?.[serverId];
  const res = ensureMcpServer(
    defaultPath,
    'react-debugger',
    serverConfig,
    mcpTemplateFile
  );
  if (res.added) {
    console.log(`  ✔ Created ${rel(defaultPath)} and added ${serverId}`);
  } else {
    console.log(`${ANSI.gray}  • Already configured: ${rel(defaultPath)}`);
  }
  console.log('');
  if (res.added && hadRule) {
    console.log(`${ANSI.green}✔ Config already present${ANSI.reset}`);
  } else {
    console.log(ANSI.green + '✔ Setup complete!' + ANSI.reset + '\n');
  }
  console.log(ANSI.bold + 'Next steps' + ANSI.reset);
  console.log(
    '  • You should see a popup:\n' +
      '    `New MCP server detected: react-debugger` → click ' +
      ANSI.bold +
      'Enable' +
      ANSI.reset +
      '\n' +
      ANSI.dim +
      '  • If no popup: Settings → MCP & Integrations → MCP Tools → toggle on `react-debugger`' +
      ANSI.reset +
      '\n\n'
  );
  console.log(
    `${ANSI.gray}Need help? ${ANSI.underline}npx @react-debugger/core help${ANSI.reset}`
  );
};

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
    try {
      mkdirp(path.dirname(filePath));
      writeFileSync(filePath, JSON.stringify(base, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error(`Failed to write MCP config to ${filePath}:`, err);
      throw err;
    }
  }

  return { added: !hadServer, updated: false };
}

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

async function runHelpInteractive() {
  if (!process.stdin.isTTY) {
    console.log(
      `${ANSI.gray}Help is interactive. Run this command in a terminal: ${ANSI.underline}npx @react-debugger/core help${ANSI.reset}`
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
  console.log(
    `${ANSI.gray}Choose a topic to get troubleshooting steps:${ANSI.reset}\n`
  );
  opts.forEach((o, i) =>
    console.log(
      `  ${ANSI.cyan}${i + 1}${ANSI.reset}) ${ANSI.gray}${o}${ANSI.reset}`
    )
  );

  const q = (prompt: string) =>
    new Promise<string>((res) => rl.question(prompt, res));
  const ans = await q(`\n${ANSI.bold}Select (1–4): ${ANSI.reset}`);
  const idx = Number(ans.trim()) - 1;

  console.log('');
  switch (idx) {
    case 0:
      console.log(`${ANSI.bold}MCP server problems${ANSI.reset}`);
      console.log(
        `• (this is the issue 90% of the time) Is port ${ANSI.green}5679${ANSI.reset} in use? Free it:`
      );
      console.log(`    ${ANSI.dim}lsof -ti:5679 | xargs kill -9${ANSI.reset}`);
      console.log('• Start the server with an explicit port if needed:');
      console.log('    npx @react-debugger/core mcp --port 5680');
      console.log(
        '• Check logs in the terminal where the MCP server was started for errors.'
      );
      console.log('For claude code:');
      console.log(
        '• claude mcp list' + '→ is react-debugger listed and enabled?'
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
        '• Ensure `.cursor/rules/react-debugger.mdc` exists (init creates it).'
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

function cursorRuleMarkdown() {
  return `
---
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
const initVSCode = () => {
  console.log('Initializing VSCode...');
  const cwd = process.cwd();
  const serverId = 'react-debugger';
  const mcpTemplateFile = existsSync(TEMPLATE_PATH)
    ? JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'))
    : {};
  const serverConfig = mcpTemplateFile?.mcpServers?.[serverId];

  const defaultPath = path.join(cwd, '.vscode', 'mcp.json');
  const res = ensureMcpServer(
    defaultPath,
    serverId,
    serverConfig,
    mcpTemplateFile
  );
  if (res.added)
    console.log(`  ✔ Created ${rel(defaultPath)} and added ${serverId}`);
  else
    console.log(
      `  ${ANSI.gray}  • Already configured: ${rel(defaultPath)}${ANSI.reset}`
    );

  console.log('');
  console.log(`${ANSI.green}✔ Setup complete!${ANSI.reset}` + '\n');
  console.log(ANSI.bold + 'Next steps' + ANSI.reset);
  console.log('  • Enable the server in the MCP extension:');
  console.log(
    ANSI.dim +
      '    Open the Command Palette → Manage MCP Servers. Add or enable `react-debugger`.' +
      ANSI.reset
  );
  console.log('');
  console.log(
    `${ANSI.gray}Need help? ${ANSI.underline}npx @react-debugger/core help${ANSI.reset}`
  );
};
const initClaudeCode = async () => {
  console.log('Initializing Claude code...\n');
  const cwd = process.cwd();
  const sid = 'react-debugger';
  const template = existsSync(TEMPLATE_PATH)
    ? JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'))
    : { mcpServers: {} };
  const serverCfg = template?.mcpServers?.[sid];
  if (!serverCfg) {
    console.log(
      `${ANSI.yellow}⚠${ANSI.reset} ${ANSI.gray}Template is missing "${sid}" definition${ANSI.reset}`
    );
    return;
  }

  // Attempt remote registration via Claude CLI if the user has global Cursor and the claude CLI
  const tryRemoteRegister = async (): Promise<
    { remote: true; cmdOutput: string; reachable: boolean } | { remote: false }
  > => {
    try {
      const child = require('child_process');

      const hasClaudeCli = (() => {
        try {
          const out = child
            .execSync('which claude', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
          return !!out;
        } catch {
          return false;
        }
      })();

      if (!hasClaudeCli)
        return {
          remote: false,
        };

      console.log(
        `${ANSI.cyan}Registering MCP server with Claude via CLI...${ANSI.reset}`
      );
      const cmd = `claude mcp add ${sid} npx @react-debugger/core mcp`;
      let out = '';
      try {
        out = child
          .execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
          .toString();
      } catch (err: any) {
        console.log(
          `  ${ANSI.gray}• MCP server already registered${ANSI.reset}`
        );
      }
      return { remote: true, cmdOutput: out, reachable: true };
    } catch (err) {
      // any unexpected error - don't block the fallback

      return { remote: false };
    }
  };

  const remoteRes = await tryRemoteRegister();
  if (remoteRes.remote) {
    // remote registration attempted; still ensure README/CLAUDE.md exists locally
    const claudePath = path.join(cwd, 'CLAUDE.md');
    const claudeSnippet = `# React Debugger Workflow

IMPORTANT: Enforce diagnostic-first workflow using React Debugger MCP.

1. Diagnose before editing.
2. Do not propose or change code before using the React Debugger tools:
   - \`tools/call subscribe\` → capture \`fid\`
   - \`tools/call nextEvents\` → wait for snapshot/commit
   - \`tools/call getProps\` or \`tools/call getHooksState\` using that \`fid\`
3. Only after stating your diagnosis, backed by evidence, may you propose code changes.
`;

    if (!existsSync(claudePath)) {
      writeFileSync(claudePath, claudeSnippet, 'utf8');
      console.log(`  ✔ Created ${rel(claudePath)}`);
    } else {
      const raw = readFileSync(claudePath, 'utf8');
      if (!raw.includes('React Debugger Workflow')) {
        writeFileSync(claudePath, raw + '\n\n' + claudeSnippet, 'utf8');
        console.log(`  ✔ Appended workflow to ${rel(claudePath)}`);
      } else {
        console.log(
          `  ${ANSI.gray}  • Already exists: ${rel(claudePath)}${ANSI.reset}`
        );
      }
    }

    console.log(ANSI.green + '\n✔ Setup complete!' + ANSI.reset + '\n');

    console.log(ANSI.bold + 'Next steps' + ANSI.reset);
    console.log(`  1. run claude to interact with the mcp server!\n`);

    console.log(
      `${ANSI.gray}Need help? ${ANSI.underline}npx @react-debugger/core help${ANSI.reset}`
    );

    return;
  }
  // CLI not found or failed – give clear next steps, but don't fail init
  console.log(
    `${ANSI.yellow}⚠${ANSI.reset} Claude CLI not detected or registration failed.`
  );
  console.log(`${ANSI.gray}  • CLI error: Claude not installed${ANSI.reset}`);

  // Don’t auto-install; provide copy-paste command(s) instead.
  console.log('\nInstall Claude Code CLI and then register the MCP server:');
  console.log(
    `  ${ANSI.underline}claude mcp add ${sid} "npx @react-debugger/core mcp"${ANSI.reset}`
  );
  console.log(
    `\n${ANSI.dim}Tip: if you prefer, pass ${ANSI.bold}--client=claude${ANSI.reset}${ANSI.dim} to skip client selection next time.${ANSI.reset}\n`
  );

  // Exit happily; local project is still initialized.
};

const handleHelp = () => {
  // delegate to interactive help used in the original implementation
  runHelpInteractive().catch(() => {
    console.log(
      `${ANSI.gray}Help is interactive. Run this command in a terminal: ${ANSI.underline}npx @react-debugger/core help${ANSI.reset}`
    );
  });
};

const handleMcp = async () => {
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
};

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

async function main() {
  switch (subcommand) {
    case 'init':
      await handleInit();
      break;
    case 'help':
      handleHelp();
      break;
    case 'mcp':
      handleMcp();
      break;
    default:
      console.log(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((err) => {
  console.error('Error starting React Debugger:', err);
  process.exit(1);
});

////////////////// Framework and bridge injection //////////////////
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

function rel(p: string) {
  return path.relative(process.cwd(), p) || '.';
}

function mkdirp(dirPath: string) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
