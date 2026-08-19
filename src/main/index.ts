/**
 * Electron Main 入口
 *
 * P0 階段：極簡版，只做 wiring
 * - 建立 settings 視窗
 * - 建立系統匣
 * - 註冊全域熱鍵
 * - 處理 IPC（GET_SETTINGS / SAVE_SETTINGS / SHOW_SETTINGS）
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { appState } from './app-state';
import { createMainWindow, showMainWindow, getMainWindow } from './windows';
import { createTray, destroyTray } from './tray';
import { hotkeyManager } from '../functions/hotkey/manager';
import { lifecycle } from './lifecycle';
import { DEFAULT_HOTKEY } from '../shared/constants';
import type { AppSettings } from '../shared/types';

// 單一實例鎖
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    // 1. 建立視窗與系統匣
    createMainWindow();
    createTray();

    // 2. 註冊熱鍵
    const ok = hotkeyManager.register(DEFAULT_HOTKEY);
    if (!ok) {
      console.warn(`[main] hotkey ${DEFAULT_HOTKEY} register failed`);
    }

    // 3. IPC handlers
    registerIpcHandlers();

    // 4. macOS 特殊處理（雖然 P0 是 Windows 優先）
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        showMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    // Windows/Linux：背景常駐
    // macOS：除非明確 quit 否則保持運行
    if (process.platform !== 'darwin') {
      // 不主動 quit，讓 tray 留住 app
    }
  });

  app.on('before-quit', () => {
    lifecycle.isQuitting = true;
    hotkeyManager.unregister();
    destroyTray();
  });
}

function registerIpcHandlers(): void {
  // 取得設定
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    return appState.getSettings();
  });

  // 儲存設定
  ipcMain.handle(IPC.SAVE_SETTINGS, (_event, partial: Partial<AppSettings>) => {
    appState.updateSettings(partial);

    // 熱鍵改變時要重新註冊
    if (partial.hotkey) {
      hotkeyManager.register(partial.hotkey);
    }

    return appState.getSettings();
  });

  // 顯示主視窗
  ipcMain.handle(IPC.SHOW_SETTINGS, () => {
    showMainWindow();
  });
}

// 廣播 status 變更給所有 renderer
appState.on('status:changed', (next) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.STATUS_CHANGED, { status: next });
  }
});
