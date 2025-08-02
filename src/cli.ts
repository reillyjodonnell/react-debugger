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

async function main() {
  console.log('🚀 Starting React Debugger...');

  // Extract port from target URL
  const port = targetUrl.includes(':') ? targetUrl.split(':')[1] : '3000';

  // 2. Start debugger server in background with target port
  const server = spawn('bun', [__dirname + '/debugger-server.js', port], {
    stdio: 'inherit',
    detached: true,
  });

  // 3. Wait a sec for server to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 4. Launch Chrome with debugging
  await launchChrome(`http://${targetUrl}`);

  // 5. Keep process alive
  process.on('SIGINT', () => {
    server.kill();
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
