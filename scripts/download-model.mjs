#!/usr/bin/env node
/**
 * scripts/download-model.mjs
 *
 * 下載 ASR 模型到 %APPDATA%\speak2t\models\<preset>\
 *
 * 用法：
 *   node scripts/download-model.mjs                            → 互動選單（CLI 模式）
 *   node scripts/download-model.mjs sherpa-zh-en               → 直接下載（CLI 模式）
 *   node scripts/download-model.mjs --json sherpa-zh-en        → JSON 事件流（main 進程用）
 *   node scripts/download-model.mjs --list                     → 列出可用模型
 *   node scripts/download-model.mjs --json --list              → 列出模型為 JSON
 *
 * 退出代碼：
 *   0 成功
 *   1 下載失敗
 *   2 解壓失敗
 *   3 用戶取消
 *   4 參數錯誤
 *   5 模型已存在（--json 模式）
 *   130 收到 SIGTERM
 */

import { createWriteStream, existsSync, mkdirSync, statSync, rmSync, renameSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

// ===== 模式 =====
const JSON_MODE = process.argv.includes('--json');

// ===== 模型清單（與 src/functions/model/downloader.ts 同步）=====
const MODELS = {
  'sherpa-zh-en': {
    name: 'sherpa-onnx-streaming-zh-en',
    description: 'sherpa-onnx 串流模型（中英混講，~340 MB）',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2',
    archive: 'tar.bz2',
    /** 解壓後的目錄名（要原封不動） */
    extractedDir: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    /** 要刪除的 tar 解壓後多餘檔案（test_wavs/ 太大） */
    cleanup: ['test_wavs'],
    /** 用於 AsrManager 的 preset 名（要對齊 src/shared/types.ts 的 AsrModelPreset） */
    preset: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    /** 預期下載大小（bytes，用於 UI 顯示） */
    sizeBytes: 357564000,
    /**
     * tar.bz2 完整檔案的 SHA-256（hex lowercase）。
     * 用途：下載完算 hash 比對，確保檔案完整沒被截斷或竄改。
     * 來源：本機下載一次算 baseline（sherpa-onnx release 沒附 .sha256）。
     * 之後可改用 CI 從 release 自動算。
     */
    sha256: '27ffbd9ee24ad186d99acc2f6354d7992b27bcab490812510665fa8f9389c5f8',
  },
  'whisper-small': {
    name: 'whisper-small (ggml)',
    description: 'Whisper.cpp 離線模型（中英，~460 MB）',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    archive: 'bin',
    extractedDir: null,
    cleanup: [],
    preset: 'whisper-small',
    sizeBytes: 462422000,
    /**
     * ggml-small.bin 完整檔案的 SHA-256（hex lowercase）。
     * 來源：huggingface.co/ggerganov/whisper.cpp 官方 LFS。
     * 待首次下載後用 Get-FileHash 校對後填入。
     */
    sha256: null, // TODO: 首次下載後填入
  },
};

// ===== 中止 flag =====
let cancelled = false;

// SIGTERM 處理：JSON 模式優雅退出
if (JSON_MODE) {
  process.on('SIGTERM', () => {
    cancelled = true;
    emit({ event: 'cancelled', message: '收到 SIGTERM，正在取消...' });
    // 給點時間讓 stdout flush
    setTimeout(() => process.exit(130), 100);
  });
  // 忽略 SIGINT (Ctrl+C)，避免誤觸（UI 用 cancelDownload 走 SIGTERM）
  process.on('SIGINT', () => {
    /* ignore */
  });
}

// ===== 輸出輔助 =====
function emit(obj) {
  if (JSON_MODE) {
    // 一行一個 JSON 事件
    process.stdout.write(JSON.stringify(obj) + '\n');
  } else {
    // CLI 模式：console.log
    if (obj.message) console.log(obj.message);
  }
}

/**
 * Emit error event (JSON mode) or print to stderr (CLI mode)
 * @param message - 主錯誤訊息
 * @param code - 錯誤代碼（例: 'download_failed' / 'http_<status>' / 'timeout'）
 * @param details - 額外資訊（url / httpStatus / cause / stack trace 第一行）
 */
function emitError(message, code = 'error', details = {}) {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({
      event: 'error',
      code,
      message,
      timestamp: Date.now(),
      ...details,
    }) + '\n');
  } else {
    console.error(`錯誤：${message}`);
    if (details.url) console.error(`  URL: ${details.url}`);
    if (details.httpStatus) console.error(`  HTTP status: ${details.httpStatus}`);
    if (details.cause) console.error(`  原因: ${details.cause}`);
  }
}

// ===== 工具 =====
function getAppDataDir() {
  const appdata = process.env.APPDATA || process.env.HOME;
  if (!appdata) {
    throw new Error('無法判斷 userData 目錄（缺少 APPDATA / HOME 環境變數）');
  }
  return join(appdata, 'speak2t', 'models');
}

function getModelDir(preset) {
  return join(getAppDataDir(), preset);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function humanSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

function timeRemaining(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m${Math.round(seconds % 60)}s`;
  return `${Math.round(seconds / 3600)}h${Math.round((seconds % 3600) / 60)}m`;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [Y/n]: `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

async function pickModel() {
  console.log('可用的 ASR 模型：\n');
  const keys = Object.keys(MODELS);
  for (let i = 0; i < keys.length; i++) {
    const m = MODELS[keys[i]];
    console.log(`  ${i + 1}. ${keys[i]} - ${m.description}`);
  }
  console.log();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(`選擇模型 [1-${keys.length}] (輸入 q 取消): `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === 'q' || a === 'quit') {
        reject(new Error('cancelled'));
        return;
      }
      const idx = parseInt(a, 10);
      if (isNaN(idx) || idx < 1 || idx > keys.length) {
        reject(new Error(`無效選擇：${answer}`));
        return;
      }
      resolve(keys[idx - 1]);
    });
  });
}

/**
 * 下載 URL 到指定路徑，顯示進度條
 * @returns 下載的位元組數
 */
async function downloadFile(url, destPath) {
  if (!JSON_MODE) {
    console.log(`下載中: ${url}`);
  } else {
    emit({ event: 'phase', phase: 'downloading', message: `下載中: ${url}` });
  }
  const startTime = Date.now();
  let lastReportTime = startTime;
  let lastDownloaded = 0;

  // 30 秒 fetch timeout（避免網路慢到極點時 hang 整個下載流程）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('下載超時（30 秒）');
    }
    throw err;
  }
  clearTimeout(timeoutId);
  if (!response.ok) {
    // 帶 status + url 讓 UI 能顯示「HTTP 404 / 503 / URL」
    const httpErr = new Error(`HTTP ${response.status} ${response.statusText}`);
    httpErr.httpStatus = response.status;
    httpErr.url = url;
    throw httpErr;
  }
  if (!response.body) {
    throw new Error('response body is null');
  }

  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  const fileStream = createWriteStream(destPath);

  // 通知開始（含總大小）
  emit({ event: 'start', total, sizeBytes: total });

  let downloaded = 0;
  const nodeStream = Readable.fromWeb(response.body);

  // 用 for-await 直接迭代（Node 24.7 的 pipeline(..., asyncTransform) 對 web stream
  // 的 chunk 處理壞掉，會把整個 Readable 當 chunk 傳進去 → ERR_INVALID_ARG_TYPE）
  try {
    for await (const chunk of nodeStream) {
      if (cancelled) {
        fileStream.destroy();
        throw new Error('cancelled');
      }
      downloaded += chunk.length;
      // backpressure：write 回傳 false 表示 buffer 滿了，等 drain 再繼續
      if (!fileStream.write(chunk)) {
        await new Promise((resolve) => fileStream.once('drain', resolve));
      }

      const now = Date.now();
      const dt = (now - lastReportTime) / 1000;
      if (dt > 0.2 || downloaded === total) {
        const speed = dt > 0 ? (downloaded - lastDownloaded) / dt : 0;
        lastDownloaded = downloaded;
        lastReportTime = now;
        const elapsed = (now - startTime) / 1000;
        const remaining = speed > 0 ? (total - downloaded) / speed : 0;
        const pct = total > 0 ? (downloaded / total) * 100 : 0;

        if (JSON_MODE) {
          emit({
            event: 'progress',
            phase: 'downloading',
            downloaded,
            total,
            percent: Math.round(pct * 10) / 10,
            speedBps: Math.round(speed),
            remainingSec: Math.round(remaining),
            elapsedMs: Math.round(elapsed * 1000),
          });
        } else {
          const line =
            `\r  ${formatBytes(downloaded)} / ${total > 0 ? formatBytes(total) : '?'} ` +
            `(${(pct).toFixed(1)}%) ${humanSpeed(speed)} ` +
            `${total > 0 ? `剩 ${timeRemaining(remaining)}` : ''}   `;
          process.stdout.write(line);
        }
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      fileStream.end((err) => (err ? reject(err) : resolve()));
    });
  }

  if (!JSON_MODE) {
    process.stdout.write('\n');
    const totalSec = (Date.now() - startTime) / 1000;
    console.log(`✓ 下載完成：${formatBytes(downloaded)} in ${timeRemaining(totalSec)}`);
  }
  return downloaded;
}

/**
 * 計算檔案 SHA-256（streaming，避免整檔讀進記憶體）
 */
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * 下載完後驗證 SHA-256
 * - expected 為 null → 跳過（僅計算並報告實際 hash）
 * - 對上 → 回傳 { ok: true, actual }
 * - 不對 → 刪除檔案 + 拋錯（emitError）
 */
async function verifyDownloadedFile(filePath, expected) {
  if (JSON_MODE) {
    emit({ event: 'phase', phase: 'verifying', message: `驗證 SHA-256：${filePath}` });
  } else {
    console.log(`\n驗證 SHA-256：${filePath}`);
  }
  const actual = await sha256OfFile(filePath);
  if (JSON_MODE) {
    emit({ event: 'hash', algorithm: 'sha256', actual });
  } else {
    console.log(`  實際：${actual}`);
    if (expected) console.log(`  預期：${expected}`);
  }
  if (!expected) {
    if (JSON_MODE) {
      emit({ event: 'hash', algorithm: 'sha256', actual, expected: null, skipped: true });
    } else {
      console.log(`  ⚠️  跳過校驗（無 baseline hash，僅計算並記錄）`);
    }
    return { ok: true, actual, expected: null, skipped: true };
  }
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    // 算 hash 失敗 → 刪除 corrupt 檔，避免後續解壓/使用壞檔
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
    throw new Error(
      `SHA-256 驗證失敗：預期 ${expected}，實際 ${actual}（檔案可能損毀或被竄改，已刪除）`
    );
  }
  if (JSON_MODE) {
    emit({ event: 'verified', algorithm: 'sha256', actual, expected });
  } else {
    console.log(`  ✓ SHA-256 驗證通過`);
  }
  return { ok: true, actual, expected, skipped: false };
}

/**
 * 解壓 tar.bz2 到指定目錄（用 Windows 10+ 內建 tar.exe）
 */
async function extractTarBz2(archivePath, destDir) {
  if (JSON_MODE) {
    emit({ event: 'phase', phase: 'extracting', message: `解壓中: ${archivePath} → ${destDir}` });
  } else {
    console.log(`解壓中: ${archivePath} → ${destDir}`);
  }

  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xjf', archivePath, '-C', destDir], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    tar.on('error', (err) => {
      reject(new Error(`tar spawn failed: ${err.message}（Windows 10+ 預設有 tar.exe，其他系統請裝 GNU tar）`));
    });
    tar.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with code=${code}`));
      }
    });
  });
}

/**
 * 清理目錄裡不需要的檔案（例如 sherpa test_wavs/）
 */
function cleanupDir(dir, patterns) {
  for (const pattern of patterns) {
    const target = join(dir, pattern);
    if (existsSync(target)) {
      const stat = statSync(target);
      if (stat.isDirectory()) {
        if (!JSON_MODE) {
          console.log(`✓ 清理：${target}`);
        } else {
          emit({ event: 'phase', phase: 'cleanup', message: `清理：${target}` });
        }
        rmSync(target, { recursive: true, force: true });
      }
    }
  }
}

// ===== Main =====
async function main() {
  // 過濾掉 flag 參數，只留「位置參數」（模型 key）
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.startsWith('-'));

  // --list
  if (process.argv.includes('--list') || process.argv.includes('-l')) {
    if (JSON_MODE) {
      const list = Object.entries(MODELS).map(([key, m]) => ({
        key,
        name: m.name,
        description: m.description,
        preset: m.preset,
        sizeBytes: m.sizeBytes,
        targetPath: getModelDir(m.preset),
      }));
      process.stdout.write(JSON.stringify({ event: 'list', models: list }) + '\n');
    } else {
      console.log('可用的 ASR 模型：\n');
      for (const [key, m] of Object.entries(MODELS)) {
        console.log(`  ${key}`);
        console.log(`    描述：${m.description}`);
        console.log(`    URL：${m.url}`);
        console.log(`    下載目標：${getModelDir(m.preset)}\n`);
      }
    }
    return;
  }

  // --help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`用法：
  node scripts/download-model.mjs                     → 互動選單
  node scripts/download-model.mjs sherpa-zh-en        → 直接下載
  node scripts/download-model.mjs --list              → 列出可用模型
  node scripts/download-model.mjs --json sherpa-zh-en → JSON 事件流（main 進程用）
  node scripts/download-model.mjs --force sherpa-zh-en → 覆蓋已安裝的模型

  SHA-256 驗證：
  下載完會比對 MODELS.sha256（若未填則只算不驗證）。驗證失敗會自動刪除 corrupt 檔。
`);
    return;
  }

  let modelKey = args[0];
  if (!modelKey) {
    if (JSON_MODE) {
      emitError('缺少模型 key', 'invalid_args');
      process.exit(4);
    }
    try {
      modelKey = await pickModel();
    } catch (err) {
      if (err.message === 'cancelled') {
        console.log('\n已取消');
        process.exit(3);
      }
      console.error(`錯誤：${err.message}`);
      process.exit(4);
    }
  }

  const model = MODELS[modelKey];
  if (!model) {
    if (JSON_MODE) {
      emitError(`未知模型 "${modelKey}"，可用：${Object.keys(MODELS).join(', ')}`, 'invalid_args');
      process.exit(4);
    } else {
      console.error(`錯誤：未知模型 "${modelKey}"`);
      console.error(`可用：${Object.keys(MODELS).join(', ')}`);
      process.exit(4);
    }
  }

  // --force 跳過已存在檢查（用於重裝 / 強制重抓）
  const FORCE = process.argv.includes('--force') || process.argv.includes('-f');

  if (!JSON_MODE) {
    console.log(`\n📦 ${model.name}`);
    console.log(`   ${model.description}`);
    console.log(`   URL: ${model.url}`);
    if (model.sha256) console.log(`   SHA-256: ${model.sha256}`);
    console.log();
  }

  const targetDir = getModelDir(model.preset);

  // 檢查是否已存在
  if (existsSync(targetDir)) {
    if (JSON_MODE && !FORCE) {
      // UI 收到 exists 事件可決定要不要重下（user 按「重新下載」會帶 --force）
      emit({ event: 'exists', path: targetDir });
      process.exit(5);
    } else if (!JSON_MODE) {
      console.log(`⚠️  目標目錄已存在：${targetDir}`);
      if (!FORCE) {
        const ok = await confirm('要覆蓋嗎？');
        if (!ok) {
          console.log('已取消');
          process.exit(3);
        }
      }
      console.log('移除舊目錄...');
      rmSync(targetDir, { recursive: true, force: true });
    } else {
      // JSON + FORCE → 直接覆蓋
      rmSync(targetDir, { recursive: true, force: true });
    }
  }

  // 確保 models 根目錄存在
  const modelsRoot = dirname(targetDir);
  mkdirSync(modelsRoot, { recursive: true });

  // 下載到 tmp
  const tmpDir = join(tmpdir(), 'speak2t-downloads');
  mkdirSync(tmpDir, { recursive: true });
  const archiveName = model.url.split('/').pop() ?? 'model';
  const tmpArchive = join(tmpDir, `${Date.now()}-${archiveName}`);

  const downloadStart = Date.now();
  try {
    await downloadFile(model.url, tmpArchive);
  } catch (err) {
    if (cancelled) {
      // 已被 SIGTERM 觸發，不用再 emit error
      if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
      process.exit(130);
    }
    if (JSON_MODE) {
      // 帶詳細資訊給 UI（url / httpStatus / cause / stack trace 第一行）
      emitError(`下載失敗：${err.message}`, 'download_failed', {
        url: err.url ?? model.url,
        httpStatus: err.httpStatus,
        cause: err.cause?.message ?? err.code ?? null,
        stack: (err.stack ?? '').split('\n')[0],
      });
    } else {
      console.error(`\n✗ 下載失敗：${err.message}`);
      if (err.cause) console.error(`   原因：${err.cause.message ?? err.cause}`);
      if (err.httpStatus) console.error(`   HTTP status: ${err.httpStatus}`);
    }
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(1);
  }

  // SHA-256 校驗（若 MODELS 有 sha256 就強制驗證；沒有就只算 hash 給 UI 顯示）
  try {
    const result = await verifyDownloadedFile(tmpArchive, model.sha256 ?? null);
    if (!JSON_MODE) {
      if (result.skipped) {
        console.log(`（未指定預期 hash，僅顯示實際 hash 供參考）`);
      } else {
        console.log(`✓ SHA-256 校驗通過`);
      }
    }
  } catch (err) {
    if (cancelled) {
      if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
      process.exit(130);
    }
    if (JSON_MODE) {
      emitError(`校驗失敗：${err.message}`, 'checksum_mismatch', {
        url: model.url,
        expected: model.sha256,
      });
    } else {
      console.error(`\n✗ ${err.message}`);
    }
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(3);
  }

  // 解壓或搬移
  try {
    if (model.archive === 'tar.bz2') {
      // 先解到 staging dir（避免直接寫進 targetDir 後被 rmSync 連帶刪除）
      const stagingDir = `${targetDir}.extract`;
      if (existsSync(stagingDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
      }
      mkdirSync(stagingDir, { recursive: true });
      await extractTarBz2(tmpArchive, stagingDir);

      // 重新命名子目錄：stagingDir/<extractedDir> → targetDir
      if (model.extractedDir) {
        const inner = join(stagingDir, model.extractedDir);
        if (existsSync(inner)) {
          if (existsSync(targetDir)) {
            rmSync(targetDir, { recursive: true, force: true });
          }
          renameSync(inner, targetDir);
          rmSync(stagingDir, { recursive: true, force: true });
          if (!JSON_MODE) {
            console.log(`✓ 重新命名：${inner} → ${targetDir}`);
          }
        } else {
          // extractedDir 不存在（tar 沒包這層），直接用 stagingDir 當 target
          if (existsSync(targetDir)) {
            rmSync(targetDir, { recursive: true, force: true });
          }
          renameSync(stagingDir, targetDir);
          if (!JSON_MODE) {
            console.log(`✓ 解壓直接到：${targetDir}`);
          }
        }
      } else {
        // 沒指定 extractedDir（不適用於本專案模型，保留 fallback）
        if (existsSync(targetDir)) {
          rmSync(targetDir, { recursive: true, force: true });
        }
        renameSync(stagingDir, targetDir);
        if (!JSON_MODE) {
          console.log(`✓ 解壓到：${targetDir}`);
        }
      }

      // 清理不要的檔案
      if (model.cleanup?.length) {
        cleanupDir(targetDir, model.cleanup);
      }
    } else if (model.archive === 'bin') {
      mkdirSync(targetDir, { recursive: true });
      const targetFile = join(targetDir, 'ggml-small.bin');
      renameSync(tmpArchive, targetFile);
      if (!JSON_MODE) {
        console.log(`✓ 移動到：${targetFile}`);
      }
    }

    const durationMs = Date.now() - downloadStart;
    // 成功後清掉 tmp 檔（避免磁碟累積）
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    if (JSON_MODE) {
      emit({ event: 'done', path: targetDir, durationMs, sha256: model.sha256 ?? null });
    } else {
      console.log(`\n✅ 模型下載完成！`);
      console.log(`   路徑：${targetDir}`);
      console.log(`\n請重啟 Speak2T app 載入模型。`);
    }
  } catch (err) {
    if (cancelled) {
      if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
      process.exit(130);
    }
    if (JSON_MODE) {
      emitError(`解壓失敗：${err.message}`, 'extract_failed');
    } else {
      console.error(`\n✗ 解壓失敗：${err.message}`);
    }
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(2);
  }
}

main().catch((err) => {
  if (cancelled) {
    process.exit(130);
  }
  if (JSON_MODE) {
    emitError(`未預期錯誤：${err.message}`, 'unexpected');
  } else {
    console.error('未預期錯誤：', err);
  }
  process.exit(1);
});
