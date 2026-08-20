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
import { applyAutoStart } from '../functions/autostart/manager';
import { initUpdateManager, getUpdateManager } from '../functions/update/manager';
import { lifecycle } from './lifecycle';
import { DEFAULT_HOTKEY } from '../shared/constants';
import type { AppSettings } from '../shared/types';
import type {
  DownloadProgressPayload,
  DownloadCompletePayload,
  DownloadErrorPayload,
  DownloadExistsPayload,
  DownloadCancelledPayload,
  DownloadVerifiedPayload,
  TofuEstablishedPayload,
  TofuRemovedPayload,
  VerificationResultPayload,
  UpdateAvailablePayload,
  UpdateUpToDatePayload,
  UpdateDownloadProgressPayload,
  UpdateDownloadedPayload,
  UpdateErrorPayload,
} from '../shared/api';
import { verifyModel } from '../functions/model/verifier';
import type { TofuBaseline } from '../shared/types';

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

    // 8. TOFU 自我校驗事件 wiring（commit 4）
    wireTofuEvents();

    // 9. 背景跑全部已下載模型的 verify（不阻塞啟動）
    void runBackgroundVerifyAll();

    // 10. 開機自動啟動套用（P2 Stage 3）
    applyAutoStart(appState.getSettings().autoStart);
    appState.on('settings:changed', (next) => {
      applyAutoStart(next.autoStart);
    });

    // 11. 自動更新（P4 Stage 2）
    initUpdateManager();
    wireUpdateManager();

    // 12. macOS 特殊處理（雖然 P0 是 Windows 優先）
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

  // ===== TOFU 自我校驗 IPC（commit 4）=====

  // 對單一已下載模型做校驗
  ipcMain.handle(IPC.VERIFY_MODEL, async (_event, presetKey: string): Promise<VerificationResultPayload> => {
    const modelInfo = modelDownloader.listModels().find((m) => m.key === presetKey);
    if (!modelInfo) {
      throw new Error(`未知模型 key：${presetKey}`);
    }
    const tofuMap = appState.getSettings().tofuBaselines as Record<string, TofuBaseline>;
    const result = await verifyModel(modelInfo.path, {
      officialSha256: modelInfo.sha256,
      tofuBaseline: tofuMap[presetKey] ?? null,
    });
    return toVerificationPayload(presetKey, result);
  });

  // 對所有已下載模型做校驗
  ipcMain.handle(IPC.VERIFY_ALL_MODELS, async (): Promise<VerificationResultPayload[]> => {
    const results: VerificationResultPayload[] = [];
    const tofuMap = appState.getSettings().tofuBaselines as Record<string, TofuBaseline>;
    for (const m of modelDownloader.listModels()) {
      if (!m.installed) continue;
      const result = await verifyModel(m.path, {
        officialSha256: m.sha256,
        tofuBaseline: tofuMap[m.key] ?? null,
      });
      results.push(toVerificationPayload(m.key, result));
    }
    return results;
  });

  // 清除 TOFU baseline
  ipcMain.handle(IPC.REMOVE_TOFU, (_event, presetKey: string) => {
    modelDownloader.removeTofu(presetKey);
  });

  // 刪除已下載模型（commit: 刪除模型按鈕 + 修 code=5）
  ipcMain.handle(IPC.REMOVE_MODEL, (_event, presetKey: string) => {
    modelDownloader.removeModel(presetKey);
  });

  // ===== P4 Stage 2：自動更新 IPC =====

  // 觸發檢查
  ipcMain.handle(IPC.CHECK_UPDATE, () => {
    getUpdateManager().checkForUpdates();
  });

  // 套用更新
  ipcMain.handle(IPC.APPLY_UPDATE, () => {
    getUpdateManager().quitAndInstall();
  });
}

/**
 * Wire UpdateManager events → broadcast IPC
 * 同步：dev 模式提示「不檢查」
 */
function wireUpdateManager(): void {
  const m = getUpdateManager();
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  };

  m.on('devMode', () => {
    broadcast(IPC.UPDATE_DEV_MODE, { currentVersion: m.getCurrentVersion() });
    console.log('[main] update: dev mode (skip check)');
  });

  m.on('checking', () => {
    broadcast(IPC.UPDATE_CHECKING, { timestamp: Date.now() });
    console.log('[main] update: checking...');
  });

  m.on('updateAvailable', (data) => {
    const payload: UpdateAvailablePayload = { ...data, timestamp: Date.now() };
    broadcast(IPC.UPDATE_AVAILABLE, payload);
    console.log(`[main] update available: v${data.version}`);
  });

  m.on('upToDate', () => {
    const payload: UpdateUpToDatePayload = {
      currentVersion: m.getCurrentVersion(),
      timestamp: Date.now(),
    };
    broadcast(IPC.UPDATE_UP_TO_DATE, payload);
    console.log(`[main] update: up-to-date (v${m.getCurrentVersion()})`);
  });

  m.on('downloadProgress', (percent) => {
    const payload: UpdateDownloadProgressPayload = { percent, timestamp: Date.now() };
    broadcast(IPC.UPDATE_DOWNLOAD_PROGRESS, payload);
  });

  m.on('updateDownloaded', (data) => {
    const payload: UpdateDownloadedPayload = { ...data, timestamp: Date.now() };
    broadcast(IPC.UPDATE_DOWNLOADED, payload);
    console.log(`[main] update downloaded: v${data.version}`);
  });

  m.on('error', (err) => {
    const payload: UpdateErrorPayload = { ...err, timestamp: Date.now() };
    broadcast(IPC.UPDATE_ERROR, payload);
    console.warn(`[main] update error: ${err.code} - ${err.message}`);
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

  modelDownloader.on('verified', (e) => {
    console.log(`[main] model download verified: ${e.preset} sha256=${e.actual.slice(0, 16)}…`);
    const payload: DownloadVerifiedPayload = { ...e, timestamp: Date.now() };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.DOWNLOAD_VERIFIED, payload);
      }
    }
  });
}

/**
 * 將 verifier 的 VerificationResult 轉成 renderer-friendly VerificationResultPayload
 */
function toVerificationPayload(preset: string, r: Awaited<ReturnType<typeof verifyModel>>): VerificationResultPayload {
  let baselineKind: 'official' | 'tofu' | 'none';
  if (r.officialSha256) {
    baselineKind = r.status === 'official-verified' || r.status === 'mismatch' ? 'official' : 'none';
  } else if (r.tofuBaseline) {
    baselineKind = 'tofu';
  } else {
    baselineKind = 'none';
  }
  return {
    preset,
    status: r.status,
    actualHash: r.actualHash,
    fileSize: r.fileSize,
    baselineKind,
    officialSha256: r.officialSha256,
    tofuSha256: r.tofuBaseline?.sha256 ?? null,
    timestamp: Date.now(),
  };
}

/**
 * Wire TOFU 自我校驗事件 → broadcast IPC
 * commit 4：TOFU baseline 建立 / 移除 / 校驗結果都即時通知 renderer
 */
function wireTofuEvents(): void {
  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  };

  modelDownloader.on('tofuEstablished', (e) => {
    console.log(`[main] TOFU baseline 已建立：${e.preset}`);
    const payload: TofuEstablishedPayload = { ...e, timestamp: Date.now() };
    broadcast(IPC.TOFU_ESTABLISHED, payload);
  });

  modelDownloader.on('tofuRemoved', (e) => {
    console.log(`[main] TOFU baseline 已移除：${e.preset}`);
    const payload: TofuRemovedPayload = { ...e, timestamp: Date.now() };
    broadcast(IPC.TOFU_REMOVED, payload);
  });

  modelDownloader.on('verificationResult', (e) => {
    const payload = toVerificationPayload(e.preset, e.result);
    broadcast(IPC.VERIFICATION_RESULT, payload);
    if (payload.status === 'mismatch') {
      // 印清楚「哪個 baseline 對不上 + actual / expected」方便 user 排查
      const expected =
        payload.baselineKind === 'official'
          ? payload.officialSha256
          : payload.baselineKind === 'tofu'
            ? payload.tofuSha256
            : null;
      const expectedShort = expected ? `${expected.slice(0, 16)}…` : '?';
      console.warn(
        `[main] 模型校驗失敗：${e.preset} ` +
          `actual=${e.result.actualHash?.slice(0, 16)}… ` +
          `expected(${payload.baselineKind})=${expectedShort} ` +
          `→ 建議重新下載`,
      );
    }
  });
}

/**
 * 背景跑全部已下載模型的校驗（commit 4）
 * 啟動時呼叫，背景不阻塞；結果透過 verificationResult event 廣播
 *
 * 不阻擋：每個模型若驗失敗，console.warn 但不 throw
 */
async function runBackgroundVerifyAll(): Promise<void> {
  try {
    const results = await modelDownloader.verifyAll();
    const mismatched = results.filter((r) => r.status === 'mismatch');
    if (mismatched.length > 0) {
      console.warn(
        `[main] 背景校驗發現 ${mismatched.length} 個模型檔案被竊改或損壞，建議重新下載`,
      );
    } else {
      console.log(`[main] 背景校驗：${results.length} 個模型全部通過`);
    }
  } catch (err) {
    console.warn(
      `[main] 背景校驗失敗：${err instanceof Error ? err.message : String(err)}`,
    );
  }
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
