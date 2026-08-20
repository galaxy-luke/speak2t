#!/usr/bin/env node
/**
 * scripts/download-model.mjs
 *
 * 下載 ASR 模型到 %APPDATA%\speak2t\models\<preset>\
 *
 * 用法：
 *   node scripts/download-model.mjs                     → 互動選單
 *   node scripts/download-model.mjs sherpa-zh-en        → 直接下載
 *   node scripts/download-model.mjs whisper-small       → 直接下載
 *   node scripts/download-model.mjs --list              → 列出可用模型
 *
 * 下載目標：
 *   sherpa-zh-en  → GitHub Release tar.bz2（自動解壓）
 *   whisper-small → HuggingFace ggml-small.bin（直接存）
 *
 * 退出代碼：
 *   0 成功
 *   1 下載失敗
 *   2 解壓失敗
 *   3 用戶取消
 *   4 參數錯誤
 */

import { createWriteStream, existsSync, mkdirSync, statSync, rmSync, renameSync, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

// ===== 模型清單 =====
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
  },
  'whisper-small': {
    name: 'whisper-small (ggml)',
    description: 'Whisper.cpp 離線模型（中英，~460 MB）',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    archive: 'bin',
    extractedDir: null,
    cleanup: [],
    preset: 'whisper-small',
  },
};

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
  console.log(`下載中: ${url}`);
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

  let downloaded = 0;
  // Node 18+ fetch body 是 ReadableStream，要轉成 Node Readable
  const nodeStream = Readable.fromWeb(response.body);

  let lastPercent = -1;
  const writer = pipeline(nodeStream, async (chunk) => {
    downloaded += chunk.length;
    fileStream.write(chunk);

    // 每 0.2 秒更新一次進度（避免太頻繁的 stdout write）
    const now = Date.now();
    if (now - lastReportTime > 200 || downloaded === total) {
      const elapsed = (now - startTime) / 1000;
      const speed = (downloaded - lastDownloaded) / ((now - lastReportTime) / 1000);
      lastDownloaded = downloaded;
      lastReportTime = now;
      const pct = total > 0 ? (downloaded / total * 100).toFixed(1) : '?';
      const remaining = speed > 0 ? (total - downloaded) / speed : 0;
      const line =
        `\r  ${formatBytes(downloaded)} / ${total > 0 ? formatBytes(total) : '?'} ` +
        `(${pct}%) ${humanSpeed(speed)} ` +
        `${total > 0 ? `剩 ${timeRemaining(remaining)}` : ''}   `;
      process.stdout.write(line);
    }
  });

  await writer;
  await new Promise((resolve, reject) => {
    fileStream.end((err) => (err ? reject(err) : resolve()));
  });

  process.stdout.write('\n');
  const totalSec = (Date.now() - startTime) / 1000;
  console.log(`✓ 下載完成：${formatBytes(downloaded)} in ${timeRemaining(totalSec)}`);
  return downloaded;
}

/**
 * 解壓 tar.bz2 到指定目錄（用 Windows 10+ 內建 tar.exe）
 */
async function extractTarBz2(archivePath, destDir) {
  console.log(`解壓中: ${archivePath} → ${destDir}`);

  return new Promise((resolve, reject) => {
    // Windows 10+ 內建 tar.exe 支援 .tar.bz2
    // -xjf：解壓 bzip2 + tar
    // -C：指定目標目錄
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
        rmSync(target, { recursive: true, force: true });
        console.log(`✓ 清理：${target}`);
      }
    }
  }
}

// ===== Main =====
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.includes('-l')) {
    console.log('可用的 ASR 模型：\n');
    for (const [key, m] of Object.entries(MODELS)) {
      console.log(`  ${key}`);
      console.log(`    描述：${m.description}`);
      console.log(`    URL：${m.url}`);
      console.log(`    下載目標：${getModelDir(m.preset)}\n`);
    }
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`用法：
  node scripts/download-model.mjs                     → 互動選單
  node scripts/download-model.mjs sherpa-zh-en        → 直接下載
  node scripts/download-model.mjs whisper-small       → 直接下載
  node scripts/download-model.mjs --list              → 列出可用模型
`);
    return;
  }

  let modelKey = args[0];
  if (!modelKey) {
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
    console.error(`錯誤：未知模型 "${modelKey}"`);
    console.error(`可用：${Object.keys(MODELS).join(', ')}`);
    process.exit(4);
  }

  console.log(`\n📦 ${model.name}`);
  console.log(`   ${model.description}`);
  console.log(`   URL: ${model.url}\n`);

  const targetDir = getModelDir(model.preset);

  // 檢查是否已存在
  if (existsSync(targetDir)) {
    console.log(`⚠️  目標目錄已存在：${targetDir}`);
    const ok = await confirm('要覆蓋嗎？');
    if (!ok) {
      console.log('已取消');
      process.exit(3);
    }
    console.log('移除舊目錄...');
    rmSync(targetDir, { recursive: true, force: true });
  }

  // 確保 models 根目錄存在
  const modelsRoot = dirname(targetDir);
  mkdirSync(modelsRoot, { recursive: true });

  // 下載到 tmp
  const tmpDir = join(tmpdir(), 'speak2t-downloads');
  mkdirSync(tmpDir, { recursive: true });
  const archiveName = model.url.split('/').pop() ?? 'model';
  const tmpArchive = join(tmpDir, `${Date.now()}-${archiveName}`);

  try {
    await downloadFile(model.url, tmpArchive);
  } catch (err) {
    console.error(`\n✗ 下載失敗：${err.message}`);
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(1);
  }

  // 解壓或搬移
  try {
    if (model.archive === 'tar.bz2') {
      // 為 tar 解壓先建好目錄
      mkdirSync(targetDir, { recursive: true });
      await extractTarBz2(tmpArchive, targetDir);

      // tar 解壓會把 extractedDir 的內容直接放進 targetDir
      // 檢查是否需要把 extractedDir 改名（讓目錄結構 = model.preset）
      if (model.extractedDir) {
        const inner = join(targetDir, model.extractedDir);
        if (existsSync(inner) && inner !== targetDir) {
          // 把 targetDir/* 搬進 inner 結構不對，直接 rename inner 為 targetDir
          // 實際上 targetDir = inner 內容直接解出，所以 inner 應該等於 targetDir
          // 但實際流程是：先 mkdir targetDir，再 -xjf 到 targetDir
          // tar 會解出 extractedDir/ 整個目錄，所以變成 targetDir/extractedDir/
          // 我們要 rename extractedDir → targetDir
          // 簡化：rm targetDir，把 inner 改名為 targetDir
          rmSync(targetDir, { recursive: true, force: true });
          renameSync(inner, targetDir);
          console.log(`✓ 重新命名：${inner} → ${targetDir}`);
        }
      }

      // 清理不要的檔案
      if (model.cleanup?.length) {
        cleanupDir(targetDir, model.cleanup);
      }
    } else if (model.archive === 'bin') {
      // 直接存 .bin 檔
      mkdirSync(targetDir, { recursive: true });
      const targetFile = join(targetDir, 'ggml-small.bin');
      renameSync(tmpArchive, targetFile);
      console.log(`✓ 移動到：${targetFile}`);
    }

    console.log(`\n✅ 模型下載完成！`);
    console.log(`   路徑：${targetDir}`);
    console.log(`\n請重啟 Speak2T app 載入模型。`);
  } catch (err) {
    console.error(`\n✗ 解壓失敗：${err.message}`);
    if (existsSync(tmpArchive)) {
      rmSync(tmpArchive, { force: true });
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('未預期錯誤：', err);
  process.exit(1);
});
