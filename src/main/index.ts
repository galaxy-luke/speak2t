/**
 * Electron Main 入口
 *
 * P0 階段：極簡版，只做 wiring
 * P1 階段：加入 audio ingest 接收（ASR 留 P1 stage 2）
 *
 * 職責：
 * - 建立 settings 視窗
 * - 建立系統匣
 * - 註冊全域熱鍵
 * - 處理 IPC（GET_SETTINGS / SAVE_SETTINGS / SHOW_SETTINGS / AUDIO_CHUNK）
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { appState } from './app-state';
import { createMainWindow, showMainWindow } from './windows';
import { createTray, destroyTray } from './tray';
import { hotkeyManager } from '../functions/hotkey/manager';
import { audioIngest } from '../functions/audio/ingest';
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

    // 3. 音訊 ingest wiring
    wireAudioIngest();

    // 4. IPC handlers
    registerIpcHandlers();

    // 5. macOS 特殊處理（雖然 P0 是 Windows 優先）
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
    audioIngest.stop();
    destroyTray();
  });
}

/**
 * 連接 audio.ingest 的 level event 到 indicator renderer（broadcast）
 * 階段 4 會接真正的 indicator window；現在先 broadcast 給所有 renderer
 */
function wireAudioIngest(): void {
  audioIngest.on('level', (level) => {
    // 廣播到所有 renderer（目前只有 settings window，stage 4 加 indicator window）
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.INDICATOR_LEVEL, { level, timestamp: Date.now() });
      }
    }
  });

  audioIngest.on('chunk', (samples, sampleRate) => {
    // 階段 2 會把這個 listener 接到 ASR engine
    // 階段 1 暫時只 log
    if (process.env.SPEAK2T_DEBUG_AUDIO === '1') {
      console.log(`[main] audio chunk: ${samples.length} samples @ ${sampleRate}Hz`);
    }
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

  // Audio chunk 接收
  ipcMain.on(IPC.AUDIO_CHUNK, (_event, payload: { samples: Float32Array; sampleRate: number }) => {
    audioIngest.feed(payload.samples, payload.sampleRate);
  });
}

// 廣播 status 變更給所有 renderer
appState.on('status:changed', (next) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.STATUS_CHANGED, { status: next });
    }
  }
});
