/**
 * IPC channel 名稱常數（main ↔ renderer 通信用）
 *
 * 命名規則：<方向>:<模組>:<動作>
 * - main→renderer: 'broadcast:' 或 'notify:'
 * - renderer→main: 'invoke:' 或 'send:'
 */

export const IPC = {
  // ===== P0 既有 =====
  /** 廣播：應用程式狀態改變 */
  STATUS_CHANGED: 'broadcast:status:changed',

  /** 廣播：錄音熱鍵觸發（P0 階段測試用） */
  HOTKEY_TRIGGERED: 'broadcast:hotkey:triggered',

  /** 取得當前設定 */
  GET_SETTINGS: 'invoke:settings:get',

  /** 儲存設定 */
  SAVE_SETTINGS: 'invoke:settings:save',

  /** 顯示主視窗 */
  SHOW_SETTINGS: 'invoke:window:show-settings',

  // ===== P1 新增 =====

  // audio（renderer → main）
  /** 推送 PCM audio chunk。Float32Array 走 transferable 零拷貝。 */
  AUDIO_CHUNK: 'send:audio:chunk',

  // asr（main → renderer 廣播）
  /** ASR partial result（邊說邊出文字） */
  ASR_PARTIAL: 'broadcast:asr:partial',
  /** ASR final result（一句結束） */
  ASR_FINAL: 'broadcast:asr:final',
  /** ASR 錯誤 */
  ASR_ERROR: 'broadcast:asr:error',

  // hotkey（main → renderer 廣播；切換模式時通知所有 renderer）
  /** 熱鍵觸發開始錄音 */
  HOTKEY_RECORD_START: 'broadcast:hotkey:record-start',
  /** 熱鍵觸發停止錄音 */
  HOTKEY_RECORD_STOP: 'broadcast:hotkey:record-stop',

  // indicator（main → indicator renderer 廣播）
  /** 指示器狀態切換 */
  INDICATOR_STATE: 'broadcast:indicator:state',
  /** 音量條 level（0.0 ~ 1.0） */
  INDICATOR_LEVEL: 'broadcast:indicator:level',
  /** partial 文字 */
  INDICATOR_TEXT: 'broadcast:indicator:text',
} as const;
