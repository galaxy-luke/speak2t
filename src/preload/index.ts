/**
 * Preload Script
 *
 * 透過 contextBridge 暴露安全的 API 給 renderer。
 * renderer 不能直接 require Node.js 模組。
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { AppSettings } from '../shared/types';
import type {
  Speak2tApi,
  HotkeyEventPayload,
  StatusEventPayload,
  AsrPartialPayload,
  AsrFinalPayload,
  AsrErrorPayload,
  IndicatorStatePayload,
  IndicatorLevelPayload,
  IndicatorTextPayload,
  ModelInfo,
  DownloadProgressPayload,
  DownloadCompletePayload,
  DownloadErrorPayload,
  DownloadExistsPayload,
  DownloadCancelledPayload,
  DownloadVerifiedPayload,
  AsrPostprocessedPayload,
  AsrEngineDegradedPayload,
  UpdateAvailablePayload,
  UpdateUpToDatePayload,
  UpdateDownloadProgressPayload,
  UpdateDownloadedPayload,
  UpdateErrorPayload,
} from '../shared/api';

const api: Speak2tApi = {
  // ===== 設定 =====
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS) as Promise<AppSettings>,
  saveSettings: (partial) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, partial) as Promise<AppSettings>,

  // ===== 視窗控制 =====
  showSettings: () => ipcRenderer.invoke(IPC.SHOW_SETTINGS) as Promise<void>,

  // ===== Audio（renderer → main）=====
  /**
   * 推送 PCM audio chunk。100ms Float32 @ 16kHz ≈ 6.4KB，結構化克隆可接受。
   * sampleRate 必須跟 ASR 引擎期待的一致（預設 16000）。
   */
  sendAudioChunk: (samples, sampleRate) => {
    // 結構化克隆：renderer→main 的 IPC 邊界會複製整個 Float32Array
    // 後端收到後 samples 是新的 Float32Array
    ipcRenderer.send(IPC.AUDIO_CHUNK, { samples, sampleRate });
  },

  /**
   * 通知 main 開始錄音（啟動 ASR 串流 + audio ingest）
   */
  startRecord: () => {
    ipcRenderer.send(IPC.START_RECORD);
  },

  /**
   * 通知 main 停止錄音（結束 ASR 串流 + 寫 wav 檔）
   */
  stopRecord: () => {
    ipcRenderer.send(IPC.STOP_RECORD);
  },

  // ===== 事件訂閱（回傳 unsubscribe 函式） =====

  // P0 既有
  onHotkeyTriggered: (callback) => {
    const listener = (_event: unknown, data: HotkeyEventPayload) => callback(data);
    ipcRenderer.on(IPC.HOTKEY_TRIGGERED, listener);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_TRIGGERED, listener);
  },

  onStatusChanged: (callback) => {
    const listener = (_event: unknown, data: StatusEventPayload) => callback(data);
    ipcRenderer.on(IPC.STATUS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.STATUS_CHANGED, listener);
  },

  // P1 熱鍵事件
  onHotkeyRecordStart: (callback) => {
    const listener = (_event: unknown, data: { timestamp: number }) => callback(data);
    ipcRenderer.on(IPC.HOTKEY_RECORD_START, listener);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_RECORD_START, listener);
  },

  onHotkeyRecordStop: (callback) => {
    const listener = (_event: unknown, data: { timestamp: number }) => callback(data);
    ipcRenderer.on(IPC.HOTKEY_RECORD_STOP, listener);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_RECORD_STOP, listener);
  },

  // P1 ASR 事件
  onAsrPartial: (callback) => {
    const listener = (_event: unknown, data: AsrPartialPayload) => callback(data);
    ipcRenderer.on(IPC.ASR_PARTIAL, listener);
    return () => ipcRenderer.removeListener(IPC.ASR_PARTIAL, listener);
  },

  onAsrFinal: (callback) => {
    const listener = (_event: unknown, data: AsrFinalPayload) => callback(data);
    ipcRenderer.on(IPC.ASR_FINAL, listener);
    return () => ipcRenderer.removeListener(IPC.ASR_FINAL, listener);
  },

  onAsrError: (callback) => {
    const listener = (_event: unknown, data: AsrErrorPayload) => callback(data);
    ipcRenderer.on(IPC.ASR_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.ASR_ERROR, listener);
  },

  // P1 指示器事件（給 indicator renderer 用）
  onIndicatorState: (callback) => {
    const listener = (_event: unknown, data: IndicatorStatePayload) => callback(data);
    ipcRenderer.on(IPC.INDICATOR_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.INDICATOR_STATE, listener);
  },

  onIndicatorLevel: (callback) => {
    const listener = (_event: unknown, data: IndicatorLevelPayload) => callback(data);
    ipcRenderer.on(IPC.INDICATOR_LEVEL, listener);
    return () => ipcRenderer.removeListener(IPC.INDICATOR_LEVEL, listener);
  },

  onIndicatorText: (callback) => {
    const listener = (_event: unknown, data: IndicatorTextPayload) => callback(data);
    ipcRenderer.on(IPC.INDICATOR_TEXT, listener);
    return () => ipcRenderer.removeListener(IPC.INDICATOR_TEXT, listener);
  },

  // ===== P2：模型下載 =====

  // model download（renderer → main）
  listModels: () => ipcRenderer.invoke(IPC.LIST_MODELS) as Promise<ModelInfo[]>,
  downloadModel: (presetKey) => ipcRenderer.invoke(IPC.DOWNLOAD_MODEL, presetKey) as Promise<void>,
  cancelDownload: () => ipcRenderer.invoke(IPC.CANCEL_DOWNLOAD) as Promise<void>,

  // model download 事件訂閱
  onDownloadProgress: (callback) => {
    const listener = (_event: unknown, data: DownloadProgressPayload) => callback(data);
    ipcRenderer.on(IPC.DOWNLOAD_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_PROGRESS, listener);
  },
  onDownloadComplete: (callback) => {
    const listener = (_event: unknown, data: DownloadCompletePayload) => callback(data);
    ipcRenderer.on(IPC.DOWNLOAD_COMPLETE, listener);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_COMPLETE, listener);
  },
  onDownloadError: (callback) => {
    const listener = (_event: unknown, data: DownloadErrorPayload) => callback(data);
    ipcRenderer.on(IPC.DOWNLOAD_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_ERROR, listener);
  },
  onDownloadExists: (callback) => {
    const listener = (_event: unknown, data: DownloadExistsPayload) => callback(data);
    ipcRenderer.on(IPC.DOWNLOAD_EXISTS, listener);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_EXISTS, listener);
  },
  onDownloadCancelled: (callback) => {
    const listener = (_event: unknown, data: DownloadCancelledPayload) => callback(data);
    ipcRenderer.on(IPC.DOWNLOAD_CANCELLED, listener);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_CANCELLED, listener);
  },
  onDownloadVerified: (callback) => {
    const listener = (_event: unknown, data: DownloadVerifiedPayload) => callback(data);
    ipcRenderer.on(IPC.DOWNLOAD_VERIFIED, listener);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_VERIFIED, listener);
  },

  // ===== P3：ASR 後處理事件 =====

  onAsrPostprocessed: (callback) => {
    const listener = (_event: unknown, data: AsrPostprocessedPayload) => callback(data);
    ipcRenderer.on(IPC.ASR_POSTPROCESSED, listener);
    return () => ipcRenderer.removeListener(IPC.ASR_POSTPROCESSED, listener);
  },

  onAsrEngineDegraded: (callback) => {
    const listener = (_event: unknown, data: AsrEngineDegradedPayload) => callback(data);
    ipcRenderer.on(IPC.ASR_ENGINE_DEGRADED, listener);
    return () => ipcRenderer.removeListener(IPC.ASR_ENGINE_DEGRADED, listener);
  },

  // ===== P4：自動更新 =====

  checkForUpdate: () => ipcRenderer.invoke(IPC.CHECK_UPDATE) as Promise<void>,
  applyUpdate: () => ipcRenderer.invoke(IPC.APPLY_UPDATE) as Promise<void>,

  onUpdateDevMode: (callback) => {
    const listener = (_event: unknown, data: { currentVersion: string }) => callback(data);
    ipcRenderer.on(IPC.UPDATE_DEV_MODE, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_DEV_MODE, listener);
  },
  onUpdateChecking: (callback) => {
    const listener = (_event: unknown, data: { timestamp: number }) => callback(data);
    ipcRenderer.on(IPC.UPDATE_CHECKING, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_CHECKING, listener);
  },
  onUpdateAvailable: (callback) => {
    const listener = (_event: unknown, data: UpdateAvailablePayload) => callback(data);
    ipcRenderer.on(IPC.UPDATE_AVAILABLE, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_AVAILABLE, listener);
  },
  onUpdateUpToDate: (callback) => {
    const listener = (_event: unknown, data: UpdateUpToDatePayload) => callback(data);
    ipcRenderer.on(IPC.UPDATE_UP_TO_DATE, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_UP_TO_DATE, listener);
  },
  onUpdateDownloadProgress: (callback) => {
    const listener = (_event: unknown, data: UpdateDownloadProgressPayload) => callback(data);
    ipcRenderer.on(IPC.UPDATE_DOWNLOAD_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_DOWNLOAD_PROGRESS, listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (_event: unknown, data: UpdateDownloadedPayload) => callback(data);
    ipcRenderer.on(IPC.UPDATE_DOWNLOADED, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_DOWNLOADED, listener);
  },
  onUpdateError: (callback) => {
    const listener = (_event: unknown, data: UpdateErrorPayload) => callback(data);
    ipcRenderer.on(IPC.UPDATE_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.UPDATE_ERROR, listener);
  },
};

contextBridge.exposeInMainWorld('speak2t', api);
