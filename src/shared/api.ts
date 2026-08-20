/**
 * 跨進程的 API 介面定義
 *
 * 這個型別同時在：
 * - preload/index.ts 實作（透過 contextBridge 暴露）
 * - renderer 端透過 globalThis.speak2t 使用
 *
 * 確保 main / preload / renderer 三方對 API shape 有一致共識。
 */

import type { AppSettings, AppStatus } from './types';

export interface Speak2tApi {
  // ===== 設定 =====
  getSettings: () => Promise<AppSettings>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;

  // ===== 視窗控制 =====
  showSettings: () => Promise<void>;

  // ===== Audio（renderer → main）=====
  /**
   * 推送 PCM audio chunk。Float32Array 會走 transferable 零拷貝。
   * @param samples - Float32Array，-1.0 ~ 1.0 範圍
   * @param sampleRate - 取樣率（必須 = recognizer 期待的 sampleRate，預設 16000）
   */
  sendAudioChunk: (samples: Float32Array, sampleRate: number) => void;

  /**
   * 通知 main 開始錄音（啟動 ASR 串流 + audio ingest）
   */
  startRecord: () => void;

  /**
   * 通知 main 停止錄音（結束 ASR 串流 + 寫 wav 檔）
   */
  stopRecord: () => void;

  // ===== 事件訂閱 =====

  /** 熱鍵觸發（P0 通用） */
  onHotkeyTriggered: (callback: (data: HotkeyEventPayload) => void) => () => void;
  /** 應用程式狀態改變 */
  onStatusChanged: (callback: (data: StatusEventPayload) => void) => () => void;

  /** P1：熱鍵觸發開始錄音 */
  onHotkeyRecordStart: (callback: (data: { timestamp: number }) => void) => () => void;
  /** P1：熱鍵觸發停止錄音 */
  onHotkeyRecordStop: (callback: (data: { timestamp: number }) => void) => () => void;

  /** P1：ASR partial result */
  onAsrPartial: (callback: (data: AsrPartialPayload) => void) => () => void;
  /** P1：ASR final result */
  onAsrFinal: (callback: (data: AsrFinalPayload) => void) => () => void;
  /** P1：ASR 錯誤 */
  onAsrError: (callback: (data: AsrErrorPayload) => void) => () => void;

  /** P1：指示器狀態切換（給 indicator renderer 用） */
  onIndicatorState: (callback: (data: IndicatorStatePayload) => void) => () => void;
  /** P1：音量條（給 indicator renderer 用） */
  onIndicatorLevel: (callback: (data: IndicatorLevelPayload) => void) => () => void;
  /** P1：partial 文字（給 indicator renderer 用） */
  onIndicatorText: (callback: (data: IndicatorTextPayload) => void) => () => void;
}

// ===== 既有 payload =====
export interface HotkeyEventPayload {
  timestamp: number;
}

export interface StatusEventPayload {
  status: AppStatus;
}

// ===== P1 payload =====

/** ASR partial result（邊說邊出的暫時文字） */
export interface AsrPartialPayload {
  text: string;
  isEndpoint: boolean;
  segment: number;
  timestamp: number;
}

/** ASR final result（一段語音結束後的最終文字） */
export interface AsrFinalPayload {
  text: string;
  segment: number;
  durationMs: number;
  timestamp: number;
}

/** ASR 錯誤 */
export interface AsrErrorPayload {
  code: string;
  message: string;
  timestamp: number;
}

/** 指示器狀態 */
export interface IndicatorStatePayload {
  state: 'idle' | 'recording' | 'processing' | 'error';
  timestamp: number;
}

/** 音量條 level（0.0 ~ 1.0） */
export interface IndicatorLevelPayload {
  level: number;
  timestamp: number;
}

/** partial 文字 */
export interface IndicatorTextPayload {
  text: string;
  timestamp: number;
}

declare global {
  interface Window {
    speak2t: Speak2tApi;
  }
}
