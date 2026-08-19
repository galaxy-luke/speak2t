/**
 * 系統匣（P0 簡化版）
 *
 * 暫時不繪製專屬 icon，用 Electron 預設的 placeholder。
 * P1 階段會加：
 * - 待機/錄音中 icon 切換
 * - 完整右鍵選單
 */

import { Tray, Menu, app, nativeImage } from 'electron';
import { showMainWindow } from './windows';
import { lifecycle } from './lifecycle';

let tray: Tray | null = null;

export function createTray(): Tray {
  // P0: 暫時建立一個簡單 tray（無 icon，會顯示預設 placeholder）
  // 實際 icon 會在 P1 加入 assets/icon.png
  tray = new Tray(createPlaceholderIcon());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '開啟 Speak2T',
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

  tray.setToolTip('Speak2T — 語音輸入工具');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());

  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * 暫時建立一個 16x16 透明 icon。
 * 真實 icon 在 P1 階段建立。
 */
function createPlaceholderIcon(): Electron.NativeImage {
  // 1x1 透明 PNG
  const buffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  return nativeImage.createFromBuffer(buffer);
}
