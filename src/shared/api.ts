/**
 * 跨進程的 API 介面定義
 *
 * 這個型別同時在：
 * - preload/index.ts 實作（透過 contextBridge 暴露）
 * - renderer 端透過 globalThis.speak2t 使用
 *
 * 確保 main / preload / renderer 三方對 API shape 有一致共識。
 */

import type { AppSettings, AppStatus, AsrEngineType } from './types';

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

  // ===== P2 新增 =====

  // model download（renderer → main）
  /** 列出所有可用模型（含本機是否已安裝） */
  listModels: () => Promise<ModelInfo[]>;
  /** 啟動下載（async non-blocking，丟錯表示已在下載中或參數錯誤） */
  downloadModel: (presetKey: string) => Promise<void>;
  /** 取消當前下載 */
  cancelDownload: () => Promise<void>;

  // model download 事件訂閱
  /** 下載進度 */
  onDownloadProgress: (callback: (data: DownloadProgressPayload) => void) => () => void;
  /** 下載完成 */
  onDownloadComplete: (callback: (data: DownloadCompletePayload) => void) => () => void;
  /** 下載失敗 */
  onDownloadError: (callback: (data: DownloadErrorPayload) => void) => () => void;
  /** 模型已存在 */
  onDownloadExists: (callback: (data: DownloadExistsPayload) => void) => () => void;
  /** 取消 */
  onDownloadCancelled: (callback: (data: DownloadCancelledPayload) => void) => () => void;
  /** SHA-256 校驗結果（verify 通過時觸發） */
  onDownloadVerified: (callback: (data: DownloadVerifiedPayload) => void) => () => void;

  // ===== TOFU 自我校驗（commit 3-4）=====

  /** 對單一已下載模型做校驗（手動觸發） */
  verifyModel: (presetKey: string) => Promise<VerificationResultPayload>;
  /** 對所有已下載模型做校驗（app 啟動時背景 / 手動觸發） */
  verifyAllModels: () => Promise<VerificationResultPayload[]>;
  /** 清除某個 preset 的 TOFU baseline */
  removeTofuBaseline: (presetKey: string) => Promise<void>;
  /** 刪除已下載的模型（遞迴刪目錄 + 移除 TOFU baseline）— commit: 刪除模型 + 修 code=5 */
  removeModel: (presetKey: string) => Promise<void>;

  /** TOFU baseline 已建立 */
  onTofuEstablished: (callback: (data: TofuEstablishedPayload) => void) => () => void;
  /** TOFU baseline 已移除 */
  onTofuRemoved: (callback: (data: TofuRemovedPayload) => void) => () => void;
  /** 校驗結果（給 UI 顯示 5 態標籤） */
  onVerificationResult: (callback: (data: VerificationResultPayload) => void) => () => void;

  // ===== P3 新增 =====

  /** P3：ASR 文字後處理結果（給 debug UI 用） */
  onAsrPostprocessed: (callback: (data: AsrPostprocessedPayload) => void) => () => void;
  /** P3：引擎降級通知 */
  onAsrEngineDegraded: (callback: (data: AsrEngineDegradedPayload) => void) => () => void;

  // ===== P4 新增 =====

  // 自動更新（renderer → main）
  /** 觸發檢查更新（async non-blocking） */
  checkForUpdate: () => Promise<void>;
  /** 套用更新（quit + install） */
  applyUpdate: () => Promise<void>;

  // 自動更新事件訂閱
  onUpdateDevMode: (callback: (data: { currentVersion: string }) => void) => () => void;
  onUpdateChecking: (callback: (data: { timestamp: number }) => void) => () => void;
  onUpdateAvailable: (callback: (data: UpdateAvailablePayload) => void) => () => void;
  onUpdateUpToDate: (callback: (data: UpdateUpToDatePayload) => void) => () => void;
  onUpdateDownloadProgress: (callback: (data: UpdateDownloadProgressPayload) => void) => () => void;
  onUpdateDownloaded: (callback: (data: UpdateDownloadedPayload) => void) => () => void;
  onUpdateError: (callback: (data: UpdateErrorPayload) => void) => () => void;
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

// ===== P2 新增 payload =====

/** 模型基本資訊 */
export interface ModelInfo {
  key: string;
  name: string;
  description: string;
  preset: string;
  sizeBytes: number;
  path: string;
  installed: boolean;
  /**
   * 預期 SHA-256（hex lowercase），下載完會校對。
   * null = 該模型還沒建立 baseline。
   */
  sha256: string | null;
}

/** 下載進度 */
export interface DownloadProgressPayload {
  preset: string;
  phase: 'downloading' | 'extracting' | 'cleanup' | 'done';
  downloaded: number;
  total: number;
  percent: number;
  speedBps: number;
  remainingSec: number;
  message?: string;
  timestamp: number;
}

/** 下載完成 */
export interface DownloadCompletePayload {
  preset: string;
  path: string;
  durationMs: number;
  timestamp: number;
}

/** 下載失敗 */
export interface DownloadErrorPayload {
  preset: string;
  /** 錯誤代碼（download_failed / spawn_error / http_<status> / timeout / extract_failed / checksum_mismatch 等） */
  code: string;
  /** 主錯誤訊息 */
  message: string;
  /** 失敗的 URL（網路錯誤時） */
  url?: string;
  /** HTTP status code（4xx/5xx 時） */
  httpStatus?: number;
  /** 底層原因（ECONNRESET / ENOSPC / ETIMEDOUT 等） */
  cause?: string;
  /** stack trace 第一行（debug 用） */
  stack?: string;
  /** 預期 SHA-256（checksum_mismatch 才有） */
  expected?: string;
  /** 實際 SHA-256（checksum_mismatch 才有） */
  actual?: string;
  timestamp: number;
}

/** SHA-256 校驗事件（verify 通過時 / 跳過時） */
export interface DownloadVerifiedPayload {
  preset: string;
  algorithm: 'sha256';
  /** 實際算出的 hash（hex lowercase） */
  actual: string;
  /** 預期 hash（若無則 null = 跳過比對） */
  expected: string | null;
  /** true = 跳過比對（沒 baseline），false = 比對通過 */
  skipped: boolean;
  timestamp: number;
}

/** 模型已存在 */
export interface DownloadExistsPayload {
  preset: string;
  path: string;
  timestamp: number;
}

/** 取消下載 */
export interface DownloadCancelledPayload {
  preset: string;
  timestamp: number;
}

// ===== TOFU 自我校驗 payload（commit 3-4）=====

/** TOFU baseline 已建立（從 downloader 自動建 / 手動建時觸發） */
export interface TofuEstablishedPayload {
  preset: string;
  /** 新建的 baseline */
  baseline: {
    sha256: string;
    sizeBytes: number;
    establishedAt: string;
    source: 'auto' | 'manual';
  };
  timestamp: number;
}

/** TOFU baseline 已移除（UI 清除按鈕觸發） */
export interface TofuRemovedPayload {
  preset: string;
  timestamp: number;
}

/** 校驗結果（5 態）— 給 UI 顯示標籤用 */
export type VerificationStatusValue =
  | 'official-verified'
  | 'tofu-verified'
  | 'mismatch'
  | 'no-baseline'
  | 'not-installed';

export interface VerificationResultPayload {
  preset: string;
  status: VerificationStatusValue;
  /** 整體 hash（hex lowercase）；not-installed 時為 null */
  actualHash: string | null;
  /** 總大小 */
  fileSize: number;
  /** 哪個 baseline 在比（official / tofu）— 給 UI 顯示細節用 */
  baselineKind: 'official' | 'tofu' | 'none';
  /** 官方 baseline hex（若有） */
  officialSha256: string | null;
  /** TOFU baseline sha256（若有） */
  tofuSha256: string | null;
  timestamp: number;
}

// ===== P3 新增 payload =====

/** ASR 文字經過後處理的詳細結果 */
export interface AsrPostprocessedPayload {
  /** 原始 ASR 輸出 */
  original: string;
  /** 後處理後文字（注入到剪貼簿的版本） */
  processed: string;
  /** 套用且改變文字的規則 ID 列表 */
  appliedRules: string[];
  /** 被 disabled 跳過的規則 ID 列表 */
  skippedRules: string[];
  /** 是否有變化 */
  changed: boolean;
  timestamp: number;
}

/** ASR 引擎降級通知（sherpa 失敗 → 自動切 whisper） */
export interface AsrEngineDegradedPayload {
  /** 原 engine */
  from: AsrEngineType;
  /** 降級目標 engine */
  to: AsrEngineType;
  /** 降級原因 */
  reason: string;
  timestamp: number;
}

// ===== P4 新增 payload =====

/** 找到新版本 */
export interface UpdateAvailablePayload {
  version: string;
  releaseDate?: string;
  timestamp: number;
}

/** 已是最新 */
export interface UpdateUpToDatePayload {
  currentVersion: string;
  timestamp: number;
}

/** 下載進度 */
export interface UpdateDownloadProgressPayload {
  percent: number;
  timestamp: number;
}

/** 下載完成 */
export interface UpdateDownloadedPayload {
  version: string;
  timestamp: number;
}

/** 更新錯誤 */
export interface UpdateErrorPayload {
  code: string;
  message: string;
  timestamp: number;
}

declare global {
  interface Window {
    speak2t: Speak2tApi;
  }
}
