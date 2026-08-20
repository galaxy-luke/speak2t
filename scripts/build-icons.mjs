#!/usr/bin/env node
/**
 * scripts/build-icons.mjs
 *
 * 從 assets/icon.png（512x512 任意格式：PNG/JPEG）產出 electron-builder 需要的 icon.ico
 * 自動偵測格式並轉成 PNG → 產 ICO（多尺寸：16, 32, 48, 64, 128, 256）
 *
 * 用法：node scripts/build-icons.mjs
 * 輸入：assets/icon.png（512x512 透明背景 microphone icon）
 * 輸出：
 *   - assets/icon.ico       （Windows installer / 應用程式 icon）
 *   - assets/icon-square.png（512x512 PNG，給 Mac 通用）
 *   - assets/tray-icon.png  （256x256 PNG，給 main/tray.ts 用）
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ICON_SRC = join(ROOT, 'assets', 'icon.png');
const ICON_PNG_OUT = join(ROOT, 'assets', 'icon-square.png');
const ICON_OUT = join(ROOT, 'assets', 'icon.ico');
const TRAY_OUT = join(ROOT, 'assets', 'tray-icon.png');

if (!existsSync(ICON_SRC)) {
  console.error(`✗ 找不到 source icon: ${ICON_SRC}`);
  console.error('  請先建立 512x512 麥克風 icon (PNG/JPEG)');
  process.exit(1);
}

console.log(`[build-icons] 從 ${ICON_SRC} 讀取並標準化`);

// 用 Jimp 統一成 512x512 PNG
const image = await Jimp.read(ICON_SRC);
const resized = image.resize({ w: 512, h: 512 });

const pngBuffer = await resized.getBuffer('image/png');
writeFileSync(ICON_PNG_OUT, pngBuffer);
console.log(`✓ 產出 ${ICON_PNG_OUT} (${pngBuffer.length} bytes, 512x512)`);

// 產 ICO（多尺寸，NSIS 需要）
console.log(`[build-icons] 產 icon.ico (多尺寸)`);
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  ICO_SIZES.map(async (size) => {
    const small = image.resize({ w: size, h: size });
    return await small.getBuffer('image/png');
  }),
);
const ico = await pngToIco(pngBuffers);
writeFileSync(ICON_OUT, ico);
console.log(`✓ 產出 ${ICON_OUT} (${ico.length} bytes, sizes: ${ICO_SIZES.join(',')})`);

// 簡單的系統匣 icon：256x256 PNG
const trayImg = image.resize({ w: 256, h: 256 });
const trayPng = await trayImg.getBuffer('image/png');
writeFileSync(TRAY_OUT, trayPng);
console.log(`✓ 產出 ${TRAY_OUT} (${trayPng.length} bytes, 256x256)`);

console.log('[build-icons] 完成');

