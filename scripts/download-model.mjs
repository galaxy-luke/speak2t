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

import { createWriteStream, existsSync, mkdirSync, statSync, rmSync, renameSync, createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

// ===== 模式 =====
const JSON_MODE = process.argv.includes('--json');

// ===== 模型清單（與 src/functions/model/downloader.ts 同步）=====
// 支援兩種類型：
//   type='tarbz2' (預設) — 單一 tar.bz2 下載 + 解壓
//   type='multifile'       — 多個獨立檔案（HF LFS 等），下載後直接放到 targetDir
//
// `sha256` 語義（**重要**）：
// = **整體目錄 hash**，跟 src/functions/model/verifier.ts 的 hashModelPath() 演算法一致
// = 對模型**整個目錄**的所有檔案（依檔名排序）各算 SHA-256，
//   再 concat（用 '\n' 分隔）整個串再 SHA-256 一次
// 為什麼用整體目錄 hash 而非 tar.bz2 整檔 / 各檔 hash：
//   CLI 解壓完算整體 hash + app 啟動時 verifier 算整體 hash 兩者相同，
//   不會出現「CLI 算 A、app 算 B 永遠 mismatch」的問題
// 計算工具：node scripts/download-model.mjs --print-hash <key>
const MODELS = {
  // P5 新預設：Luigi 繁中精調版（HF git LFS 多檔案，無壓縮）
  'luigi-x-asr-zh-tw-en-ft75m': {
    name: 'x-asr 繁中 (Luigi 75M)',
    description: 'Luigi 微調 75M 串流（台灣國語 1560h 精調，~132 MB，自動加標點）',
    type: 'multifile',
    /** 用於 AsrManager 的 preset 名（要對齊 src/shared/types.ts 的 AsrModelPreset） */
    preset: 'luigi-x-asr-zh-tw-en-ft75m',
    /** 預期下載大小總計（bytes，UI 顯示用） */
    sizeBytes: 138200625, // 121039545 + 13877277 + 3228486 + 56317 = ~132MB
    /**
     * 整體目錄 hash（4 個檔 concat 再 hash 一次）
     * 2026-08-20 算：40e563f8...d86060f
     */
    sha256: '40e563f8d7acc4bc22dfd8483e65ba40d68f4f9fc6c424a95d37f87cac86060f',
    /** 4 個獨立檔案（HF git LFS） */
    files: [
      {
        url: 'https://huggingface.co/Luigi/x-asr-zh-tw-en-streaming-ft75m/resolve/main/encoder.int8.onnx',
        filename: 'encoder.int8.onnx',
        sizeBytes: 121039545,
      },
      {
        url: 'https://huggingface.co/Luigi/x-asr-zh-tw-en-streaming-ft75m/resolve/main/decoder.onnx',
        filename: 'decoder.onnx',
        sizeBytes: 13877277,
      },
      {
        url: 'https://huggingface.co/Luigi/x-asr-zh-tw-en-streaming-ft75m/resolve/main/joiner.int8.onnx',
        filename: 'joiner.int8.onnx',
        sizeBytes: 3228486,
      },
      {
        url: 'https://huggingface.co/Luigi/x-asr-zh-tw-en-streaming-ft75m/resolve/main/tokens.txt',
        filename: 'tokens.txt',
        sizeBytes: 56317,
      },
    ],
  },
  // P5 新增：sherpa-onnx 官方 x-asr 簡中 480ms (int8 + 自動加標點)
  'x-asr-480ms-punct': {
    name: 'x-asr 簡中 480ms',
    description: 'sherpa-onnx 官方 x-asr 簡中 480ms（int8，~128 MB，自動加標點）',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05.tar.bz2',
    archive: 'tar.bz2',
    extractedDir: 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05',
    cleanup: [],
    preset: 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05',
    sizeBytes: 133895136,
    /**
     * 整體目錄 hash（解壓後目錄所有檔 concat 再 hash 一次）
     * TODO: 首次下載後用 `node scripts/download-model.mjs --print-hash x-asr-480ms-punct` 算回填
     * null = 該模型還沒 baseline（首次下載後自動建 TOFU 存進 settings）
     */
    sha256: null, // TODO: 首次下載後回填
  },
  // 既有：sherpa-zh-en 經典版 v2023
  'sherpa-zh-en': {
    name: 'sherpa 經典版 (v2023)',
    description: 'sherpa-onnx 串流模型（中英混講，~340 MB，無標點）',
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
     * 整體目錄 hash（解壓後目錄所有檔 concat 再 hash 一次）
     * 變更歷史：原本是 tar.bz2 整檔 hash，2026-08-20 改為整體目錄 hash 與 verifier 演算法一致
     * 2026-08-20 算：58560cb1...f9620c（10 個檔）
     */
    sha256: '58560cb167aaa25b4aa06001f581be4fabb35cab12f3f26369b080f725f9620c',
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
     * 整體 hash（單一檔案，hashModelPath 對單檔直接算 SHA-256）
     * TODO: 首次下載後用 `node scripts/download-model.mjs --print-hash whisper-small` 算回填
     * null = 該模型還沒 baseline（首次下載後自動建 TOFU 存進 settings）
     */
    sha256: null, // TODO: 首次下載後回填
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

/** 從 settings.json 讀取 TOFU baselines（commit 5：CLI --tofu-list / --verify 用） */
function loadSettingsFromDisk() {
  // settings.json 位置：<userData>/settings.json（Electron 慣例）
  const appdata = process.env.APPDATA || process.env.HOME;
  if (!appdata) return { tofuBaselines: {} };
  const settingsPath = join(appdata, 'speak2t', 'settings.json');
  if (!existsSync(settingsPath)) return { tofuBaselines: {} };
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      tofuBaselines: parsed.tofuBaselines ?? {},
    };
  } catch (err) {
    console.warn(`[cli] 讀 settings.json 失敗：${err.message}`);
    return { tofuBaselines: {} };
  }
}

/** 對模型路徑（檔案 or 目錄）算整體 hash（commit 5：CLI --verify 用） */
async function computeModelHash(modelPath) {
  const stat = statSync(modelPath);
  if (stat.isFile()) {
    const hash = await hashFile(modelPath);
    return { hash, size: stat.size };
  }
  if (!stat.isDirectory()) {
    throw new Error(`不支援的路徑型別：${modelPath}`);
  }
  const entries = readdirSync(modelPath, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  let totalSize = 0;
  const concatHashes = [];
  for (const name of fileNames) {
    const fp = join(modelPath, name);
    const fs = statSync(fp);
    if (!fs.isFile()) continue;
    const sha = await hashFile(fp);
    totalSize += fs.size;
    concatHashes.push(sha);
  }
  const overall = createHash('sha256');
  for (const sha of concatHashes) {
    overall.update(sha);
    overall.update('\n');
  }
  return { hash: overall.digest('hex'), size: totalSize };
}

/** 對單一檔案算 SHA-256（stream） */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
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
 * 對解壓 / 下載完的整體模型目錄算 hash 跟 MODELS[preset].sha256 比對
 *
 * 語義：MODELS[preset].sha256 = 整體目錄 hash（與 verifier.ts 的 hashModelPath() 演算法一致）
 *
 * 行為：
 * - expected 不為 null 且對得起來 → emit 'verified' event + 回傳 ok=true
 * - expected 不為 null 但對不起來 → 拋錯（呼叫端負責刪目錄）
 * - expected 為 null → emit 'hash' event (skipped: true) → main 端建 TOFU
 *
 * @param {string} modelPath - 解壓後的模型目錄路徑
 * @param {string|null} expected - MODELS[preset].sha256
 */
async function verifyExtractedModel(modelPath, expected) {
  if (JSON_MODE) {
    emit({ event: 'phase', phase: 'verifying', message: `校驗整體目錄 SHA-256：${modelPath}` });
  } else {
    console.log(`\n校驗整體目錄 SHA-256：${modelPath}`);
  }
  const result = await computeModelHash(modelPath);
  if (expected) {
    if (result.hash === expected) {
      if (JSON_MODE) {
        emit({ event: 'verified', algorithm: 'sha256', actual: result.hash, expected, scope: 'directory' });
      } else {
        console.log(`  ✓ 整體目錄 SHA-256 校驗通過`);
        console.log(`    預期：${expected}`);
        console.log(`    實際：${result.hash}`);
      }
      return { ok: true, actual: result.hash, expected, skipped: false };
    } else {
      const msg = `整體目錄 SHA-256 驗證失敗：${modelPath}\n  預期 ${expected}\n  實際 ${result.hash}\n  檔案可能被竊改或磁碟損壞`;
      const err = new Error(msg);
      err.expected = expected;
      err.actual = result.hash;
      throw err;
    }
  } else {
    if (JSON_MODE) {
      emit({ event: 'hash', algorithm: 'sha256', actual: result.hash, expected: null, skipped: true, scope: 'directory' });
    } else {
      console.log(`  ⚠️  跳過校驗（無 baseline hash，僅計算並記錄）`);
      console.log(`    整體目錄 SHA-256：${result.hash}`);
      console.log(`    總大小：${(result.size / 1024 / 1024).toFixed(1)} MB`);
    }
    return { ok: true, actual: result.hash, expected: null, skipped: true };
  }
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

/**
 * Multi-file 模型下載（如 Luigi HF LFS）
 * 依序下載每個檔案到 targetDir
 *
 * 注意：不在這裡校驗 per-file hash。所有校驗統一在「下載完」後對**整個目錄**算 hash 跟
 * MODELS[preset].sha256 比對（與 verifier.ts 演算法一致），避免 per-file hash 跟整體 hash
 * 永遠對不起來的問題
 *
 * 進度回報：累計 bytes / totalBytes
 */
async function downloadMultifileModel(model, targetDir, tmpDir) {
  if (!model.files || model.files.length === 0) {
    throw new Error('multifile model 必須設定 files');
  }

  // 計算 total + 起始 emit start
  const total = model.files.reduce((s, f) => s + f.sizeBytes, 0);
  if (JSON_MODE) {
    emit({ event: 'start', total, sizeBytes: total });
  }

  let downloaded = 0;

  for (let i = 0; i < model.files.length; i++) {
    if (cancelled) {
      throw new Error('cancelled');
    }
    const file = model.files[i];
    const tmpFile = join(tmpDir, `${Date.now()}-${i}-${file.filename}`);
    const finalFile = join(targetDir, file.filename);

    if (!JSON_MODE) {
      console.log(`\n📥 [${i + 1}/${model.files.length}] ${file.filename}（${formatBytes(file.sizeBytes)}）`);
      console.log(`   URL: ${file.url}`);
    } else {
      emit({
        event: 'phase',
        phase: 'downloading',
        message: `[${i + 1}/${model.files.length}] ${file.filename}（${formatBytes(file.sizeBytes)}）`,
      });
    }

    // 下載單一檔案（含進度計算：本次下載的 bytes 算到 cumulative）
    try {
      await downloadSingleFileWithOffset(file.url, tmpFile, file.sizeBytes, downloaded, total);
    } catch (err) {
      if (cancelled) {
        if (existsSync(tmpFile)) rmSync(tmpFile, { force: true });
        throw new Error('cancelled');
      }
      // 帶詳細錯誤資訊
      const wrapped = new Error(err.message);
      wrapped.url = err.url ?? file.url;
      wrapped.httpStatus = err.httpStatus;
      wrapped.cause = err.cause;
      throw wrapped;
    }
    downloaded += file.sizeBytes;

    // 從 tmp 搬到 targetDir
    if (existsSync(finalFile)) {
      rmSync(finalFile, { force: true });
    }
    renameSync(tmpFile, finalFile);
    if (!JSON_MODE) {
      console.log(`  ✓ 已存到：${finalFile}`);
    }
  }

  return { total };
}

/**
 * 單一檔案下載（multi-file 子流程），進度回報會加到 cumulative offset
 */
async function downloadSingleFileWithOffset(url, destPath, fileSize, baseDownloaded, total) {
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
    const httpErr = new Error(`HTTP ${response.status} ${response.statusText}`);
    httpErr.httpStatus = response.status;
    httpErr.url = url;
    throw httpErr;
  }
  if (!response.body) {
    throw new Error('response body is null');
  }

  const fileStream = createWriteStream(destPath);
  const nodeStream = Readable.fromWeb(response.body);
  let fileDownloaded = 0;
  const startTime = Date.now();
  let lastReportTime = startTime;
  let lastDownloaded = 0;

  try {
    for await (const chunk of nodeStream) {
      if (cancelled) {
        fileStream.destroy();
        throw new Error('cancelled');
      }
      fileDownloaded += chunk.length;
      if (!fileStream.write(chunk)) {
        await new Promise((resolve) => fileStream.once('drain', resolve));
      }
      const now = Date.now();
      const dt = (now - lastReportTime) / 1000;
      if (dt > 0.2 || (baseDownloaded + fileDownloaded) === total) {
        const speed = dt > 0 ? (fileDownloaded - lastDownloaded) / dt : 0;
        lastDownloaded = fileDownloaded;
        lastReportTime = now;
        const cumulative = baseDownloaded + fileDownloaded;
        const elapsed = (now - startTime) / 1000;
        const remaining = speed > 0 ? (total - cumulative) / speed : 0;
        const pct = total > 0 ? (cumulative / total) * 100 : 0;
        if (JSON_MODE) {
          emit({
            event: 'progress',
            phase: 'downloading',
            downloaded: cumulative,
            total,
            percent: Math.round(pct * 10) / 10,
            speedBps: Math.round(speed),
            remainingSec: Math.round(remaining),
            elapsedMs: Math.round(elapsed * 1000),
          });
        } else {
          const line =
            `\r  ${formatBytes(cumulative)} / ${formatBytes(total)} ` +
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
  if (!JSON_MODE) process.stdout.write('\n');
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
        type: m.type ?? 'tarbz2',
      }));
      process.stdout.write(JSON.stringify({ event: 'list', models: list }) + '\n');
    } else {
      console.log('可用的 ASR 模型：\n');
      for (const [key, m] of Object.entries(MODELS)) {
        console.log(`  ${key}`);
        console.log(`    描述：${m.description}`);
        if (m.type === 'multifile') {
          console.log(`    類型：multi-file（${m.files.length} 個獨立檔案）`);
          console.log(`    下載目標：${getModelDir(m.preset)}\n`);
        } else {
          console.log(`    URL：${m.url}`);
          console.log(`    下載目標：${getModelDir(m.preset)}\n`);
        }
      }
    }
    return;
  }

  // --tofu-list（commit 5：列出所有 TOFU baselines）
  if (process.argv.includes('--tofu-list')) {
    const settings = loadSettingsFromDisk();
    if (JSON_MODE) {
      process.stdout.write(JSON.stringify({ event: 'tofuList', baselines: settings.tofuBaselines }) + '\n');
    } else {
      const entries = Object.entries(settings.tofuBaselines);
      if (entries.length === 0) {
        console.log('目前沒有任何 TOFU baseline。下載模型後會自動建立。');
      } else {
        console.log(`目前有 ${entries.length} 個 TOFU baseline：\n`);
        for (const [preset, t] of entries) {
          console.log(`  ${preset}`);
          console.log(`    SHA-256: ${t.sha256.slice(0, 16)}…${t.sha256.slice(-8)}`);
          console.log(`    大小：${(t.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
          console.log(`    建立時間：${t.establishedAt}`);
          console.log(`    來源：${t.source}\n`);
        }
      }
    }
    return;
  }

  // --verify <preset>（commit 5：手動校驗單一模型）
  const verifyIdx = process.argv.indexOf('--verify');
  if (verifyIdx !== -1) {
    const preset = process.argv[verifyIdx + 1];
    if (!preset || !MODELS[preset]) {
      console.error(`錯誤：--verify 需要指定有效模型 key（可用 --list 看）`);
      process.exit(1);
    }
    const model = MODELS[preset];
    // 修正：用 model.preset（解壓後目錄名）而不是 key
    const modelPath = getModelDir(model.preset);
    if (!existsSync(modelPath)) {
      console.error(`錯誤：模型未下載 ${modelPath}`);
      process.exit(2);
    }
    const result = await computeModelHash(modelPath);
    const settings = loadSettingsFromDisk();
    const tofuMap = settings.tofuBaselines ?? {};
    if (JSON_MODE) {
      process.stdout.write(
        JSON.stringify({
          event: 'verify',
          preset,
          hash: result.hash,
          size: result.size,
          officialSha256: model.sha256 ?? null,
          tofuBaseline: tofuMap[preset] ?? null,
          status: model.sha256 === result.hash
            ? 'official-verified'
            : tofuMap[preset]?.sha256 === result.hash
              ? 'tofu-verified'
              : (model.sha256 || tofuMap[preset]) ? 'mismatch' : 'no-baseline',
        }) + '\n',
      );
    } else {
      console.log(`校驗結果：${preset}`);
      console.log(`  路徑：${modelPath}`);
      console.log(`  整體 SHA-256：${result.hash}`);
      console.log(`  總大小：${(result.size / 1024 / 1024).toFixed(1)} MB`);
      if (model.sha256) {
        const match = model.sha256 === result.hash;
        console.log(`  官方 baseline：${match ? '✅ 對得起來' : '❌ 對不起來'}`);
        console.log(`    預期：${model.sha256}`);
        console.log(`    實際：${result.hash}`);
      } else if (tofuMap[preset]) {
        const match = tofuMap[preset].sha256 === result.hash;
        console.log(`  TOFU baseline：${match ? '✅ 對得起來' : '❌ 對不起來'}`);
        console.log(`    預期：${tofuMap[preset].sha256}`);
        console.log(`    實際：${result.hash}`);
      } else {
        console.log(`  ⚠️ 沒任何 baseline（建議下載完保留磁碟檔，下次啟動會自動建 TOFU）`);
      }
    }
    return;
  }

  // --print-hash <preset>（2026-08-20：算已下載模型的整體目錄 hash 給 user 回填 baseline 用）
  // 跟 --verify 類似但只印 hash，不比對、不需要 baseline
  const printHashIdx = process.argv.indexOf('--print-hash');
  if (printHashIdx !== -1) {
    const preset = process.argv[printHashIdx + 1];
    if (!preset || !MODELS[preset]) {
      console.error(`錯誤：--print-hash 需要指定有效模型 key（可用 --list 看）`);
      process.exit(1);
    }
    const model = MODELS[preset];
    const modelPath = getModelDir(model.preset);
    if (!existsSync(modelPath)) {
      console.error(`錯誤：模型未下載 ${modelPath}`);
      console.error(`  請先下載：node scripts/download-model.mjs ${preset}`);
      process.exit(2);
    }
    const result = await computeModelHash(modelPath);
    if (JSON_MODE) {
      process.stdout.write(
        JSON.stringify({
          event: 'printHash',
          preset,
          hash: result.hash,
          size: result.size,
          modelPath,
        }) + '\n',
      );
    } else {
      console.log(`${preset} 整體目錄 hash：`);
      console.log(`  ${result.hash}`);
      console.log(`  總大小：${(result.size / 1024 / 1024).toFixed(1)} MB`);
      console.log(`  路徑：${modelPath}`);
      console.log();
      console.log(`回填到 MODELS：把上面的 hash 填進 src/functions/model/downloader.ts 跟 scripts/download-model.mjs`);
    }
    return;
  }

  // --help
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`用法：
  node scripts/download-model.mjs                       → 互動選單
  node scripts/download-model.mjs sherpa-zh-en          → 直接下載
  node scripts/download-model.mjs --list                → 列出可用模型
  node scripts/download-model.mjs --verify sherpa-zh-en → 校驗單一已下載模型
  node scripts/download-model.mjs --print-hash sherpa-zh-en  → 算已下載模型的整體 hash
  node scripts/download-model.mjs --tofu-list           → 列出所有 TOFU baseline
  node scripts/download-model.mjs --json sherpa-zh-en   → JSON 事件流（main 進程用）
  node scripts/download-model.mjs --force sherpa-zh-en  → 覆蓋已安裝的模型

  SHA-256 驗證（2026-08-20 起統一為整體目錄 hash）：
  下載 / 解壓完會對整個模型目錄算 hash（所有檔 concat 再 hash 一次）
  跟 MODELS[preset].sha256 比對。對不起來會刪除整個目錄。
  TOFU（Trust On First Use）：
  對沒官方 baseline 的模型（Luigi 已填 / x-asr / whisper 還沒），下載完成時自動建 TOFU baseline
  存進 settings.json。日後啟動時自動重算比對，偵測檔案被竊改 / 磁碟損壞。

  --print-hash 用途：
  對已下載模型算整體 hash，給 user 回填到 MODELS[preset].sha256 用。
  例：下載 x-asr 480ms 後，node scripts/download-model.mjs --print-hash x-asr-480ms-punct
  拿 hash 填回 MODELS。
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
    if (model.type === 'multifile') {
      console.log(`   類型：multi-file（${model.files.length} 個獨立檔案）`);
    } else if (model.url) {
      console.log(`   URL: ${model.url}`);
    }
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

  const downloadStart = Date.now();

  // ====== 分流：multifile vs tar.bz2/bin ======
  if (model.type === 'multifile') {
    // Multi-file 模式：直接下載到 targetDir（已是解開格式，無需解壓）
    mkdirSync(targetDir, { recursive: true });
    try {
      await downloadMultifileModel(model, targetDir, tmpDir);
    } catch (err) {
      if (cancelled) {
        rmSync(targetDir, { recursive: true, force: true });
        process.exit(130);
      }
      // 下載失敗 → 刪除整個 targetDir（避免半殘檔案）
      rmSync(targetDir, { recursive: true, force: true });
      if (JSON_MODE) {
        emitError(`下載失敗：${err.message}`, 'download_failed', {
          url: err.url,
          httpStatus: err.httpStatus,
          cause: err.cause?.message ?? err.code ?? null,
          stack: (err.stack ?? '').split('\n')[0],
        });
      } else {
        console.error(`\n✗ 下載失敗：${err.message}`);
        if (err.cause) console.error(`   原因：${err.cause.message ?? err.cause}`);
        if (err.httpStatus) console.error(`   HTTP status: ${err.httpStatus}`);
      }
      process.exit(1);
    }

    // 整體目錄 hash 校驗
    try {
      const verifyResult = await verifyExtractedModel(targetDir, model.sha256 ?? null);
      const durationMs = Date.now() - downloadStart;
      if (JSON_MODE) {
        emit({
          event: 'done',
          path: targetDir,
          durationMs,
          sha256: verifyResult.actual,
          skipped: verifyResult.skipped,
        });
      } else {
        console.log(`\n✅ 模型下載完成！`);
        console.log(`   路徑：${targetDir}`);
        console.log(`\n請重啟 Speak2T app 載入模型。`);
      }
    } catch (err) {
      if (cancelled) {
        rmSync(targetDir, { recursive: true, force: true });
        process.exit(130);
      }
      // 整體目錄 hash 對不起來 → 刪除整個目錄
      rmSync(targetDir, { recursive: true, force: true });
      if (JSON_MODE) {
        if (err.actual && err.expected) {
          emitError(`校驗失敗：${err.message}`, 'checksum_mismatch', {
            expected: err.expected,
            actual: err.actual,
          });
        } else {
          emitError(`校驗失敗：${err.message}`, 'verify_failed');
        }
      } else {
        console.error(`\n✗ ${err.message}`);
      }
      process.exit(3);
    }
    return;
  }

  // ====== 原流程：tar.bz2 / bin ======
  const archiveName = model.url?.split('/').pop() ?? 'model';
  const tmpArchive = join(tmpDir, `${Date.now()}-${archiveName}`);

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

  // 解壓或搬移
  let extractedSha256 = null;
  let extractedSkipped = false;
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

    // ===== 整體目錄 hash 校驗（與 verifier.ts 演算法一致）=====
    // 對解壓後 / 搬移後的整個目錄算 SHA-256
    // 對 MODELS[preset].sha256 比對（若無則只算 → emit 'hash' skipped: true → main 端建 TOFU）
    const verifyResult = await verifyExtractedModel(targetDir, model.sha256 ?? null);
    extractedSha256 = verifyResult.actual;
    extractedSkipped = verifyResult.skipped;

    const durationMs = Date.now() - downloadStart;
    // 成功後清掉 tmp 檔（避免磁碟累積）
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    if (JSON_MODE) {
      emit({
        event: 'done',
        path: targetDir,
        durationMs,
        sha256: extractedSha256,
        skipped: extractedSkipped,
      });
    } else {
      console.log(`\n✅ 模型下載完成！`);
      console.log(`   路徑：${targetDir}`);
      console.log(`\n請重啟 Speak2T app 載入模型。`);
    }
  } catch (err) {
    if (cancelled) {
      if (existsSync(tmpArchive)) rmSync(tmpArchive, { force: true });
      if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true });
      process.exit(130);
    }
    // 整體目錄 hash 對不起來 → 刪除整個目錄，避免 corrupt 殘留
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    if (JSON_MODE) {
      if (err.actual && err.expected) {
        emitError(`校驗失敗：${err.message}`, 'checksum_mismatch', {
          expected: err.expected,
          actual: err.actual,
        });
      } else {
        emitError(`解壓失敗：${err.message}`, 'extract_failed');
      }
    } else {
      console.error(`\n✗ ${err.message}`);
    }
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(3);
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
