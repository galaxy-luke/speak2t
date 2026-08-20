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
import { AsrManager } from '../functions/asr/manager';
import { clipboardInjector } from '../functions/injector/clipboard';
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

  app.whenReady().then(async () => {
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

    // 4. ASR manager 初始化（async，模型未下載時會失敗但不阻擋 app）
    await initAsrManager();

    // 5. IPC handlers
    registerIpcHandlers();

    // 6. macOS 特殊處理（雖然 P0 是 Windows 優先）
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
    asrManager?.dispose();
    destroyTray();
  });
}

/** AsrManager singleton（lazy init，因為 init 可能因模型不存在失敗） */
let asrManager: AsrManager | null = null;

/**
 * 連接 audio.ingest 的 level event 到 indicator renderer（broadcast）
 * 連接 audio.ingest chunk event 到 asrManager.feed()
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
    // 接到 ASR engine
    if (asrManager?.initialized) {
      asrManager.feed(samples, sampleRate);
    }
  });
}

/**
 * 初始化 ASR manager（模型未下載時會失敗，但不阻擋 app 啟動）
 */
async function initAsrManager(): Promise<void> {
  const settings = appState.getSettings();
  asrManager = new AsrManager(settings);

  asrManager.on('error', (err) => {
    console.error('[main] asr manager error:', err);
  });

  try {
    await asrManager.init();
    console.log(`[main] asr manager ready: engine=${settings.asrEngine}`);
  } catch (err) {
    // 初始化失敗（最常見：模型檔不存在）
    console.warn(`[main] asr manager init failed: ${err instanceof Error ? err.message : String(err)}`);
    console.warn('[main] ASR 功能暫時停用，請用 npm run download-model 下載模型後重啟 app');
  }
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

  // 開始錄音（renderer 通知）
  ipcMain.on(IPC.START_RECORD, () => {
    console.log('[main] START_RECORD received');
    if (!audioIngest.recording) {
      audioIngest.start();
    }
    if (asrManager?.initialized) {
      try {
        asrManager.start();
        appState.setStatus('recording');
      } catch (err) {
        console.error('[main] asr start failed:', err);
      }
    } else {
      console.warn('[main] asr manager not initialized, 純錄音模式');
    }
  });

  // 停止錄音（renderer 通知）
  ipcMain.on(IPC.STOP_RECORD, async () => {
    console.log('[main] STOP_RECORD received');
    if (asrManager?.initialized) {
      appState.setStatus('processing');
      try {
        const result = await asrManager.stop();
        console.log(`[main] ASR result: "${result.text}" (${result.durationMs}ms)`);

        // 文字注入（D-C 兩種模式：clipboard / clipboard-and-paste）
        if (result.text) {
          const settings = appState.getSettings();
          const injectResult = await clipboardInjector.inject(
            result.text,
            settings.injectionMode,
          );
          if (injectResult.ok) {
            console.log(`[main] injected ${injectResult.text.length} chars via ${settings.injectionMode}`);
          } else {
            console.warn(`[main] injection failed: ${injectResult.reason ?? 'unknown'}`);
          }
        }
      } catch (err) {
        console.error('[main] asr stop failed:', err);
      }
    }
    if (audioIngest.recording) {
      audioIngest.stop();
    }
    appState.setStatus('idle');
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
