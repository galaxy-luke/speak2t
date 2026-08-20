/**
 * 共用型別定義
 */

/** 應用程式狀態（全域） */
export type AppStatus = 'idle' | 'recording' | 'processing' | 'paused' | 'error';

/** 錄音模式 */
export type RecordingMode = 'ptt' | 'toggle';

/** 注入策略 */
export type InjectionMode = 'clipboard' | 'clipboard-and-paste';

/** 指示器位置策略 */
export type IndicatorPosition = 'bottom-center' | 'follow-cursor';

/** ASR 引擎（D-B 雙引擎） */
export type AsrEngineType = 'sherpa-onnx' | 'whisper-cpp';

/**
 * 預設 ASR 模型識別名（D-5）
 *
 * 注意：值就是模型解壓後的目錄名（GitHub release tarball 解出來的目錄名），
 * 這樣 AsrManager 直接拿這個值當 dirName，不用 mapping。
 */
export type AsrModelPreset =
  | 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20'
  | 'whisper-small';

/** 使用者設定 */
export interface AppSettings {
  hotkey: string;
  recordingMode: RecordingMode;
  injectionMode: InjectionMode;
  indicatorPosition: IndicatorPosition;
  autoStart: boolean;

  // ===== P1 新增 =====
  /** ASR 引擎（D-B 預設 sherpa-onnx-streaming） */
  asrEngine: AsrEngineType;
  /** 預設模型 preset（D-5 預設 sherpa-streaming-zh-en） */
  asrModelPreset: AsrModelPreset;
  /** 音訊取樣率（Hz），預設 16000 對齊 sherpa-onnx 期待 */
  audioSampleRate: number;
  /** 自訂模型路徑（留空 = 用預設下載位置） */
  customModelPath: string;
  /** 麥克風 deviceId（空字串 = 系統預設） */
  audioDeviceId: string;

  // ===== P3 新增 =====
  /** P3：自動標點修正（後處理器）— 預設開 */
  postprocessEnabled: boolean;
  /** P3：自動引擎降級（sherpa 失敗時自動切 whisper）— 預設開 */
  autoDegrade: boolean;
}

/** 預設設定（D-A/B/C 決策結果） */
export const DEFAULT_SETTINGS: AppSettings = {
  hotkey: 'CommandOrControl+Shift+Space',
  recordingMode: 'toggle', // D-A：預設 Toggle，PTT 留 P1+1
  injectionMode: 'clipboard-and-paste', // D-C：預設剪貼簿+自動 Ctrl+V
  indicatorPosition: 'bottom-center', // D-2
  autoStart: false, // D-7

  // P1
  asrEngine: 'sherpa-onnx', // D-B 預設 streaming
  asrModelPreset: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', // D-5
  audioSampleRate: 16000,
  customModelPath: '',
  /** 麥克風 deviceId（空字串 = 系統預設；P1 stage 6.5） */
  audioDeviceId: '',

  // P3
  postprocessEnabled: true, // P3 Stage 1
  autoDegrade: true, // P3 Stage 2
};
