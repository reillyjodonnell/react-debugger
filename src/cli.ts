#!/usr/bin/env node

import { spawn, exec } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';

// Get the directory of this script at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const targetUrl = process.argv[2] || 'localhost:3000';
const isMcpMode = process.argv.includes('--mcp');
const isMcpServerMode = process.argv.includes('--mcp-server');
const portFlagIndex = process.argv.findIndex(
  (a) => a === '--port' || a === '-p'
);
const wsPort =
  portFlagIndex > -1 ? Number(process.argv[portFlagIndex + 1]) : undefined;

async function main() {
  if (isMcpServerMode) {
    // In MCP server mode, redirect all console output to stderr to keep stdout clean for JSON-RPC
    console.error('🤖 Starting React Debugger MCP Server...');
    console.error('📡 MCP server will be available via STDIO');
    // console.error(
    //   '🌐 WebSocket server will be available at ws://localhost:5679'
    // );
    // console.error('📄 Add this script tag to your React app:');
    // console.error(
    //   '   <script src="http://localhost:5679/react-bridge-client.js"></script>'
    // );

    // Start MCP server instead of debugger server
    const { startMcpServer } = await import('./mcp-server');
    await startMcpServer(wsPort);
    return;
  }

  if (isMcpMode) {
    console.log('🤖 Starting React Debugger in MCP mode...');
    console.log('🔗 MCP server will be available at http://localhost:5679/mcp');
  } else {
    console.log('🚀 Starting React Debugger...');
  }

  // Extract port from target URL
  const port = targetUrl.includes(':') ? targetUrl.split(':')[1] : '3000';

  // 2. Start debugger server in background with target port and mode
  const args = [__dirname + '/debugger-server.js', port];
  if (isMcpMode) {
    args.push('--mcp');
  }

  const server = spawn(
    'bun',
    args.filter((arg): arg is string => Boolean(arg)),
    {
      stdio: 'inherit',
      detached: true,
    }
  );

  // 3. Wait a sec for server to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (!isMcpMode) {
    // 4. Launch Chrome with debugging (only in human mode)
    await launchChrome(`http://${targetUrl}`);
  } else {
    console.log('💡 Add this script tag to your React app:');
    const pd = wsPort || 5679;
    console.log(
      `<script src="http://localhost:${pd}/react-bridge-client.js"></script>`
    );
    console.log(`🔗 MCP WebSocket endpoint: ws://localhost:${pd}/mcp`);
  }

  // 5. Keep process alive
  process.on('SIGINT', () => {
    if ('kill' in server && typeof server.kill === 'function') {
      server.kill();
    }
    process.exit();
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
  for (const path of chromePaths) {
    try {
      if (existsSync(path)) {
        return path;
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
