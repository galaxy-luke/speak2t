/**
 * 開發啟動腳本
 *
 * 1. 啟動 Vite dev server（給 renderer 用 HMR）
 * 2. 編譯 main + preload（用 tsc -w watch 模式）
 * 3. 等 Vite 起來後啟動 Electron，並設 ELECTRON_RENDERER_URL
 *
 * Windows / macOS / Linux 通用（用 Node 原生 spawn，不用 shell 包裝）
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const TSC_MAIN = 'tsc -p tsconfig.main.json --watch --preserveWatchOutput';
const TSC_PRELOAD = 'tsc -p tsconfig.preload.json --watch --preserveWatchOutput';

let electronProcess = null;
let viteProcess = null;
let tscMainProcess = null;
let tscPreloadProcess = null;
let shuttingDown = false;

function log(prefix, message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${prefix}] ${message}`);
}

function startProcess(name, command, args, options = {}) {
  const proc = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32', // Windows 需要 shell 才能跑 .cmd
    ...options,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => log(name, line));
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => log(name, `[err] ${line}`));
  });

  proc.on('exit', (code) => {
    log(name, `exited with code ${code}`);
    if (!shuttingDown) {
      shutdown(code ?? 1);
    }
  });

  return proc;
}

async function waitForVite(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = createRequest(url);
        req.on('error', reject);
        req.on('response', (res) => {
          res.resume();
          resolve(res);
        });
        req.end();
      });
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

function createRequest(url) {
  // Node 22+ 有 global fetch，但 http.get 較直觀
  const { get } = require('node:http');
  return get(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startVite() {
  log('vite', `starting dev server on port ${VITE_PORT}`);
  viteProcess = startProcess('vite', 'npx', ['vite', '--port', String(VITE_PORT)]);
}

function startTsc() {
  log('tsc-main', 'starting watch mode');
  tscMainProcess = startProcess('tsc-main', 'npx', TSC_MAIN.split(' '));
  log('tsc-preload', 'starting watch mode');
  tscPreloadProcess = startProcess('tsc-preload', 'npx', TSC_PRELOAD.split(' '));
}

function startElectron() {
  log('electron', `starting (VITE_URL=${VITE_URL})`);
  electronProcess = startProcess('electron', 'npx', ['electron', '.'], {
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: VITE_URL,
      NODE_ENV: 'development',
    },
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('main', `shutting down (code=${code})`);

  [electronProcess, viteProcess, tscMainProcess, tscPreloadProcess].forEach((p) => {
    if (p && !p.killed) {
      try {
        p.kill('SIGTERM');
      } catch (e) {
        log('main', `kill error: ${e.message}`);
      }
    }
  });

  setTimeout(() => process.exit(code), 1000);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  startVite();

  const ready = await waitForVite(VITE_URL);
  if (!ready) {
    log('main', 'Vite dev server failed to start within timeout');
    shutdown(1);
    return;
  }

  log('vite', 'ready');
  startTsc();

  // 給 TSC 幾秒鐘先編譯
  await sleep(3000);

  startElectron();
}

main().catch((err) => {
  log('main', `fatal: ${err.message}`);
  shutdown(1);
});
