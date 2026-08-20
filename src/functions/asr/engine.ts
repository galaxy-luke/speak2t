/**
 * ASR 引擎抽象介面
 *
 * 設計：兩種引擎（sherpa-onnx-streaming + whisper.cpp）共用同一個介面，
 * 讓 AsrManager 不用關心底層實作。
 *
 * 生命週期：
 *   init(config) → start() → feed()*  → stop() → dispose()
 *
 * 事件：
 *   - 'partial'：ASR 邊讀邊出的暫時文字（isEndpoint=true 表示一句話結束）
 *   - 'error'：引擎錯誤
 *
 * P1 階段 2：SherpaOnnxEngine 實作
 * P1 階段 5：WhisperCppEngine 實作（offline 模式，buffer 累積後一次送）
 */

import type { AsrEngineType, AsrModelPreset } from '../../shared/types';

export interface AsrConfig {
  /** 引擎類型 */
  engine: AsrEngineType;
  /** 預設模型 preset */
  modelPreset: AsrModelPreset;
  /** 自訂模型路徑（若指定則覆蓋 preset 預設） */
  customPath?: string;
  /** 取樣率（Hz，預設 16000） */
  sampleRate: number;
  /** ASR 引擎路徑（auto-detect 或自訂） */
  modelDir?: string;
}

export interface AsrResult {
  /** 最終文字 */
  text: string;
  /** 段數（一段語音可能切成多個 segment） */
  segments: number;
  /** 總時長（ms） */
  durationMs: number;
}

export interface AsrEvents {
  /** ASR partial result（邊讀邊出） */
  partial: (text: string, isEndpoint: boolean, segment: number) => void;
  /** ASR 引擎錯誤 */
  error: (err: Error) => void;
  /** ASR 引擎準備好 */
  ready: () => void;
}

export interface AsrEngine {
  readonly name: string;

  /**
   * 初始化引擎（載入模型、建立 recognizer）
   * 必須先 init 才能 start/feed
   */
  init(config: AsrConfig): Promise<void>;

  /**
   * 開始新一輪 ASR 串流（建立內部 stream）
   */
  start(): void;

  /**
   * 餵入 PCM audio chunk
   * @param samples Float32Array -1.0 ~ 1.0
   * @param sampleRate 取樣率（必須 = init 設定的 sampleRate）
   */
  feed(samples: Float32Array, sampleRate: number): void;

  /**
   * 結束串流，跑最終一輪 decode，回傳結果
   */
  stop(): Promise<AsrResult>;

  /**
   * 釋放引擎資源
   */
  dispose(): void;

  /** 事件訂閱（EventEmitter-like） */
  on<U extends keyof AsrEvents>(event: U, listener: AsrEvents[U]): this;
  off<U extends keyof AsrEvents>(event: U, listener: AsrEvents[U]): this;
}
