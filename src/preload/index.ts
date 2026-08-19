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
};

contextBridge.exposeInMainWorld('speak2t', api);
