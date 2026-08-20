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
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
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

function emitError(message, code = 'error') {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ event: 'error', code, message }) + '\n');
  } else {
    console.error(`錯誤：${message}`);
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

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
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

  const writer = pipeline(nodeStream, async (chunk) => {
    if (cancelled) {
      throw new Error('cancelled');
    }
    downloaded += chunk.length;
    fileStream.write(chunk);

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
  });

  await writer;
  await new Promise((resolve, reject) => {
    fileStream.end((err) => (err ? reject(err) : resolve()));
  });

  if (!JSON_MODE) {
    process.stdout.write('\n');
    const totalSec = (Date.now() - startTime) / 1000;
    console.log(`✓ 下載完成：${formatBytes(downloaded)} in ${timeRemaining(totalSec)}`);
  }
  return downloaded;
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
  const args = process.argv.slice(2).filter((a) => a !== '--json');

  // --list
  if (args.includes('--list') || args.includes('-l')) {
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
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`用法：
  node scripts/download-model.mjs                     → 互動選單
  node scripts/download-model.mjs sherpa-zh-en        → 直接下載
  node scripts/download-model.mjs --list              → 列出可用模型
  node scripts/download-model.mjs --json sherpa-zh-en → JSON 事件流（main 進程用）
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

  if (!JSON_MODE) {
    console.log(`\n📦 ${model.name}`);
    console.log(`   ${model.description}`);
    console.log(`   URL: ${model.url}\n`);
  }

  const targetDir = getModelDir(model.preset);

  // 檢查是否已存在
  if (existsSync(targetDir)) {
    if (JSON_MODE) {
      emit({ event: 'exists', path: targetDir });
      process.exit(5);
    } else {
      console.log(`⚠️  目標目錄已存在：${targetDir}`);
      const ok = await confirm('要覆蓋嗎？');
      if (!ok) {
        console.log('已取消');
        process.exit(3);
      }
      console.log('移除舊目錄...');
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
      emitError(`下載失敗：${err.message}`, 'download_failed');
    } else {
      console.error(`\n✗ 下載失敗：${err.message}`);
    }
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(1);
  }

  // 解壓或搬移
  try {
    if (model.archive === 'tar.bz2') {
      mkdirSync(targetDir, { recursive: true });
      await extractTarBz2(tmpArchive, targetDir);

      // 重新命名子目錄
      if (model.extractedDir) {
        const inner = join(targetDir, model.extractedDir);
        if (existsSync(inner) && inner !== targetDir) {
          rmSync(targetDir, { recursive: true, force: true });
          renameSync(inner, targetDir);
          if (!JSON_MODE) {
            console.log(`✓ 重新命名：${inner} → ${targetDir}`);
          }
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
    if (JSON_MODE) {
      emit({ event: 'done', path: targetDir, durationMs });
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
