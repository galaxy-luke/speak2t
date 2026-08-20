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
 * 預設 ASR 模型識別名（D-5 / P5）
 *
 * 注意：值就是模型解壓後的目錄名（HF 檔案會放在以 preset 命名的目錄裡），
 * 這樣 AsrManager 直接拿這個值當 dirName，不用 mapping。
 *
 * P5 新增：luigi-x-asr-zh-tw-en-ft75m（Luigi 繁中精調，2026-06）
 *          sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05（x-asr 簡中 480ms）
 * 保留：sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20（經典版 v2023）
 */
export type AsrModelPreset =
  | 'luigi-x-asr-zh-tw-en-ft75m'
  | 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05'
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

  // ===== TOFU 自我校驗 =====
  /**
   * 每個已下載模型的自建 SHA-256 基線（Trust On First Use）。
   *
   * key = preset key（AsrModelPreset）
   *
   * 流程：
   * 1. 第一次下載模型時，若 preset 沒官方 SHA-256 baseline → 自動算磁碟 hash 存這裡
   * 2. 之後每次 app 啟動 / 載入模型時，重算磁碟 hash 跟這裡比對
   * 3. 不符 = 檔案被竊改 / 磁碟損壞 → 顯示警告 toast
   *
   * 跟官方 baseline（preset.sha256）互斥：有的話走官方，沒有的話走 TOFU。
   */
  tofuBaselines: Record<AsrModelPreset, TofuBaseline>;
}

/**
 * TOFU 自我校驗基線（存進 settings.json）
 *
 * 設計：
 * - `sha256`：首次下載後自動算的 hash，作為日後自我校驗的基準
 * - `sizeBytes`：對應檔案大小（用於快速 sanity check，比 hash 快）
 * - `establishedAt`：ISO 8601 timestamp，何時建立這個基線
 * - `source`：建立來源（auto = 下載完成時自動建 / manual = user 手動指定）
 */
export interface TofuBaseline {
  /** SHA-256 hash（hex lowercase） */
  sha256: string;
  /** 對應檔案大小（bytes） */
  sizeBytes: number;
  /** 建立時間（ISO 8601） */
  establishedAt: string;
  /** 建立來源 */
  source: 'auto' | 'manual';
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
  asrModelPreset: 'luigi-x-asr-zh-tw-en-ft75m', // P5 新預設：Luigi 繁中精調（速度+字義+標點）
  audioSampleRate: 16000,
  customModelPath: '',
  /** 麥克風 deviceId（空字串 = 系統預設；P1 stage 6.5） */
  audioDeviceId: '',

  // P3
  postprocessEnabled: true, // P3 Stage 1
  autoDegrade: true, // P3 Stage 2

  // TOFU 自我校驗：每個 preset 的自建 hash 基線（首次下載後自動填）
  tofuBaselines: {} as Record<AsrModelPreset, TofuBaseline>,
};
