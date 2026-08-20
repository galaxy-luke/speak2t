/**
 * Electron Main 入口
 *
 * 職責：
 * - 建立 settings 視窗 + 指示器視窗（stage 4）
 * - 建立系統匣
 * - 註冊全域熱鍵
 * - 處理 IPC（GET_SETTINGS / SAVE_SETTINGS / SHOW_SETTINGS / AUDIO_CHUNK / START_RECORD / STOP_RECORD）
 * - ASR 串流生命週期
 * - 文字注入
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { appState } from './app-state';
import {
  createMainWindow,
  showMainWindow,
  createIndicatorWindow,
  showIndicator,
  hideIndicator,
} from './windows';
import { createTray, destroyTray } from './tray';
import { hotkeyManager } from '../functions/hotkey/manager';
import { audioIngest } from '../functions/audio/ingest';
import { AsrManager } from '../functions/asr/manager';
import { clipboardInjector } from '../functions/injector/clipboard';
import { modelDownloader } from '../functions/model/downloader';
import { lifecycle } from './lifecycle';
import { DEFAULT_HOTKEY } from '../shared/constants';
import type { AppSettings } from '../shared/types';
import type { DownloadProgressPayload, DownloadCompletePayload, DownloadErrorPayload, DownloadExistsPayload, DownloadCancelledPayload } from '../shared/api';

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
    createIndicatorWindow();
    createTray();

    // 2. 註冊熱鍵
    const ok = hotkeyManager.register(DEFAULT_HOTKEY);
    if (!ok) {
      console.warn(`[main] hotkey ${DEFAULT_HOTKEY} register failed`);
    }

    // 3. 連接 hotkey toggle 事件 → record/stop 邏輯
    hotkeyManager.on('toggle', ({ isRecording }) => {
      if (isRecording) {
        doStartRecord();
      } else {
        void doStopRecord();
      }
    });

    // 4. 音訊 ingest wiring
    wireAudioIngest();

    // 5. ASR manager 初始化（async，模型未下載時會失敗但不阻擋 app）
    await initAsrManager();

    // 6. IPC handlers
    registerIpcHandlers();

    // 7. Model downloader 事件 wiring
    wireModelDownloader();

    // 8. macOS 特殊處理（雖然 P0 是 Windows 優先）
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
    if (modelDownloader.isDownloading()) {
      modelDownloader.cancelDownload();
    }
    destroyTray();
  });
}

/** AsrManager singleton（lazy init，因為 init 可能因模型不存在失敗） */
let asrManager: AsrManager | null = null;

/**
 * 連接 audio.ingest 的 level event 到 indicator renderer（broadcast）
 * 連接 audio.ingest chunk event 到 asrManager.feed()
 */
function wireAudioIngest(): void {
  audioIngest.on('level', (level) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.INDICATOR_LEVEL, { level, timestamp: Date.now() });
      }
    }
  });

  audioIngest.on('chunk', (samples, sampleRate) => {
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
    console.warn(`[main] asr manager init failed: ${err instanceof Error ? err.message : String(err)}`);
    console.warn('[main] ASR 功能暫時停用，請用 npm run download-model 下載模型後重啟 app');
  }
}

/**
 * 開始錄音（給 hotkey toggle 跟 renderer START_RECORD 共用）
 */
function doStartRecord(): void {
  console.log('[main] doStartRecord');
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
}

/**
 * 停止錄音（給 hotkey toggle 跟 renderer STOP_RECORD 共用）
 */
async function doStopRecord(): Promise<void> {
  console.log('[main] doStopRecord');
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
}

function registerIpcHandlers(): void {
  // 取得設定
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    return appState.getSettings();
  });

  // 儲存設定
  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, partial: Partial<AppSettings>) => {
    const prevSettings = appState.getSettings();
    appState.updateSettings(partial);

    // 熱鍵改變時要重新註冊
    if (partial.hotkey) {
      hotkeyManager.register(partial.hotkey);
    }

    // P2 Stage 1：ASR 引擎或模型變更時自動切換引擎
    if (
      asrManager?.initialized &&
      (partial.asrEngine !== undefined || partial.asrModelPreset !== undefined)
    ) {
      const engineChanged = partial.asrEngine !== undefined && partial.asrEngine !== prevSettings.asrEngine;
      const presetChanged =
        partial.asrModelPreset !== undefined && partial.asrModelPreset !== prevSettings.asrModelPreset;
      if (engineChanged || presetChanged) {
        try {
          await asrManager.switchEngine(appState.getSettings());
          console.log(
            `[main] ASR engine switched: ${prevSettings.asrEngine}/${prevSettings.asrModelPreset} → ${appState.getSettings().asrEngine}/${appState.getSettings().asrModelPreset}`,
          );
        } catch (err) {
          console.error('[main] ASR switch engine failed:', err);
          // 切換失敗：回滾 settings（避免 UI 顯示不一致）
          appState.updateSettings({
            asrEngine: prevSettings.asrEngine,
            asrModelPreset: prevSettings.asrModelPreset,
          });
        }
      }
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

  // 開始錄音（renderer 觸發，例如 P1 stage 1 的按鈕測試用）
  ipcMain.on(IPC.START_RECORD, () => {
    doStartRecord();
  });

  // 停止錄音（renderer 觸發）
  ipcMain.on(IPC.STOP_RECORD, () => {
    void doStopRecord();
  });

  // ===== P2：模型下載 IPC =====

  // 列出所有模型
  ipcMain.handle(IPC.LIST_MODELS, () => {
    return modelDownloader.listModels();
  });

  // 啟動下載
  ipcMain.handle(IPC.DOWNLOAD_MODEL, (_event, presetKey: string) => {
    modelDownloader.startDownload(presetKey);
  });

  // 取消下載
  ipcMain.handle(IPC.CANCEL_DOWNLOAD, () => {
    modelDownloader.cancelDownload();
  });
}

/**
 * Wire ModelDownloader events → broadcast to all renderer
 * 同步：下載完成時自動 reload ASR manager（用新下載的模型）
 */
function wireModelDownloader(): void {
  modelDownloader.on('progress', (e) => {
    const payload: DownloadProgressPayload = { ...e, timestamp: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.DOWNLOAD_PROGRESS, payload);
      }
    }
  });

  modelDownloader.on('complete', async (e) => {
    console.log(`[main] model download complete: ${e.preset} → ${e.path} (${e.durationMs}ms)`);
    const payload: DownloadCompletePayload = { ...e, timestamp: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.DOWNLOAD_COMPLETE, payload);
      }
    }
    // 自動 reload ASR（讓新下載的模型立即可用）
    if (asrManager) {
      try {
        await asrManager.switchEngine(appState.getSettings());
        console.log('[main] ASR manager reloaded with new model');
      } catch (err) {
        console.warn(`[main] ASR reload after download failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  modelDownloader.on('error', (e) => {
    console.error(`[main] model download error: ${e.code} - ${e.message}`);
    const payload: DownloadErrorPayload = { ...e, timestamp: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.DOWNLOAD_ERROR, payload);
      }
    }
  });

  modelDownloader.on('exists', (e) => {
    const payload: DownloadExistsPayload = { ...e, timestamp: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.DOWNLOAD_EXISTS, payload);
      }
    }
  });

  modelDownloader.on('cancelled', (e) => {
    const payload: DownloadCancelledPayload = { ...e, timestamp: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.DOWNLOAD_CANCELLED, payload);
      }
    }
  });
}

// 廣播 status 變更給所有 renderer + 控制 indicator 顯示
appState.on('status:changed', (next) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.STATUS_CHANGED, { status: next });
    }
  }

  // 控制 indicator 浮窗顯示
  if (next === 'recording' || next === 'processing') {
    showIndicator();
  } else if (next === 'idle' || next === 'error') {
    // 短暫延遲隱藏，讓 final 結果能顯示 0.5s
    setTimeout(() => {
      hideIndicator();
    }, 500);
  }
});
