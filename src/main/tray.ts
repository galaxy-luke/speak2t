/**
 * 系統匣
 *
 * P4 Stage 1：使用 assets/tray-icon.png（256x256）作為系統匣 icon
 * 之後可加：待機/錄音中 icon 切換、完整右鍵選單
 */

import { Tray, Menu, app, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { showMainWindow } from './windows';
import { lifecycle } from './lifecycle';

let tray: Tray | null = null;

export function createTray(): Tray {
  // P4 Stage 1：用真實 icon（assets/tray-icon.png）
  // dev 模式從 cwd，packaged 模式從 resources
  const iconPath = join(process.cwd(), 'assets', 'tray-icon.png');
  if (existsSync(iconPath)) {
    tray = new Tray(iconPath);
  } else {
    // 找不到時 fallback placeholder
    tray = new Tray(createPlaceholderIcon());
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '開啟 聲打 / Speak2T',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: '結束',
      click: () => {
        lifecycle.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('聲打 / Speak2T — 語音輸入工具');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());

  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * Fallback 1x1 透明 PNG（icon 檔找不到時用）
 */
function createPlaceholderIcon(): Electron.NativeImage {
  const buffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  return nativeImage.createFromBuffer(buffer);
}
