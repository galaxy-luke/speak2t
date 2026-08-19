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
import { get as httpGet } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VITE_PORT = 5173;
const VITE_URL = `http://localhost:${VITE_PORT}`;

let electronProcess = null;
let viteProcess = null;
let tscMainProcess = null;
let tscPreloadProcess = null;
let shuttingDown = false;

function log(prefix, message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${prefix}] ${message}`);
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

/**
 * 用 process.execPath（node）跑 node_modules 裡的 script
 * 優點：跨平台、不需要 .cmd shim、不開 shell（避免 DEP0190 警告）
 */
function runScript(scriptRelPath, args, name, extraEnv = {}) {
  const scriptPath = join(ROOT, 'node_modules', scriptRelPath);
  const fullArgs = [scriptPath, ...args];

  log(name, `spawn: ${execPath} ${fullArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

  const proc = spawn(execPath, fullArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    // 關鍵：shell: false（預設）— 不開 shell 避免子進程殘留
    windowsHide: true,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => log(name, line));
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach((line) => log(name, `[stderr] ${line}`));
  });

  proc.on('exit', (code, signal) => {
    log(name, `exited code=${code} signal=${signal ?? 'null'}`);
    // 只有「非 0 exit」或「signal kill」才視為失敗
    // vite 啟動後印一堆 deprecation 警告是正常的，不該 trigger shutdown
    if (!shuttingDown && code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
      log(name, `non-zero exit, shutting down`);
      shutdown(code ?? 1);
    }
  });

  proc.on('error', (err) => {
    log(name, `spawn error: ${err.message}`);
    if (!shuttingDown) {
      shutdown(1);
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
  return httpGet(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startVite() {
  log('vite', `starting dev server on port ${VITE_PORT}`);
  viteProcess = runScript('vite/bin/vite.js', ['--port', String(VITE_PORT)], 'vite');
}

function startTsc() {
  log('tsc-main', 'starting watch mode');
  tscMainProcess = runScript('typescript/bin/tsc', ['-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput'], 'tsc-main');
  log('tsc-preload', 'starting watch mode');
  tscPreloadProcess = runScript('typescript/bin/tsc', ['-p', 'tsconfig.preload.json', '--watch', '--preserveWatchOutput'], 'tsc-preload');
}

function startElectron() {
  log('electron', `starting (VITE_URL=${VITE_URL})`);
  electronProcess = runScript('electron/cli.js', ['.'], 'electron', {
    ELECTRON_RENDERER_URL: VITE_URL,
    NODE_ENV: 'development',
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('main', `shutting down (code=${code})`);

  [electronProcess, viteProcess, tscMainProcess, tscPreloadProcess].forEach((p, idx) => {
    if (p && !p.killed && p.exitCode === null) {
      const name = ['electron', 'vite', 'tsc-main', 'tsc-preload'][idx];
      try {
        log('main', `killing ${name} (pid=${p.pid})`);
        // Windows 上 SIGTERM 會失敗，要用 taskkill
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(p.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          p.kill('SIGTERM');
        }
      } catch (e) {
        log('main', `kill error: ${e.message}`);
      }
    }
  });

  setTimeout(() => process.exit(code), 2000);
}

process.on('SIGINT', () => {
  log('main', 'received SIGINT');
  shutdown(0);
});
process.on('SIGTERM', () => {
  log('main', 'received SIGTERM');
  shutdown(0);
});

async function main() {
  startVite();

  const ready = await waitForVite(VITE_URL);
  if (!ready) {
    log('main', `Vite dev server failed to start within timeout (port ${VITE_PORT} may still be in use)`);
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
  console.error(err);
  shutdown(1);
});
