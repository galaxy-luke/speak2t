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

  /** 開始錄音（renderer → main 通知 start ASR + ingest） */
  START_RECORD: 'send:record:start',
  /** 停止錄音（renderer → main 通知 stop ASR + ingest） */
  STOP_RECORD: 'send:record:stop',

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

  // ===== P2 新增 =====

  // model download（renderer → main）
  /** 列出所有可用模型（含本機是否已安裝） */
  LIST_MODELS: 'invoke:model:list',
  /** 啟動下載（async non-blocking） */
  DOWNLOAD_MODEL: 'invoke:model:download',
  /** 取消當前下載 */
  CANCEL_DOWNLOAD: 'invoke:model:cancel',

  // model download（main → renderer 廣播）
  /** 下載進度 */
  DOWNLOAD_PROGRESS: 'broadcast:download:progress',
  /** 下載完成 */
  DOWNLOAD_COMPLETE: 'broadcast:download:complete',
  /** 下載失敗 */
  DOWNLOAD_ERROR: 'broadcast:download:error',
  /** 模型已存在（跳過下載） */
  DOWNLOAD_EXISTS: 'broadcast:download:exists',
  /** 使用者取消下載 */
  DOWNLOAD_CANCELLED: 'broadcast:download:cancelled',
  /** SHA-256 校驗結果（verify 通過時） */
  DOWNLOAD_VERIFIED: 'broadcast:download:verified',

  // TOFU 自我校驗（commit 3-4 新增）
  /** 對單一已下載模型做校驗（手動觸發） */
  VERIFY_MODEL: 'invoke:model:verify',
  /** 對所有已下載模型做校驗（app 啟動時背景 / 手動觸發） */
  VERIFY_ALL_MODELS: 'invoke:model:verify-all',
  /** 清除某個 preset 的 TOFU baseline */
  REMOVE_TOFU: 'invoke:model:remove-tofu',

  // TOFU 事件（main → renderer 廣播）
  /** TOFU baseline 已建立 */
  TOFU_ESTABLISHED: 'broadcast:tofu:established',
  /** TOFU baseline 已移除 */
  TOFU_REMOVED: 'broadcast:tofu:removed',
  /** 校驗結果（給 UI 顯示 5 態標籤） */
  VERIFICATION_RESULT: 'broadcast:verification:result',

  // ===== P3 新增 =====

  // ASR 後處理（main → renderer 廣播）
  /** 標點後處理結果（給 debug UI 用） */
  ASR_POSTPROCESSED: 'broadcast:asr:postprocessed',
  /** 引擎自動降級通知（sherpa 失敗 → 切 whisper） */
  ASR_ENGINE_DEGRADED: 'broadcast:asr:engine-degraded',

  // ===== P4 新增 =====

  // 自動更新（renderer → main）
  /** 觸發檢查更新 */
  CHECK_UPDATE: 'invoke:update:check',
  /** 套用更新（下載完成後呼叫，會 quit app） */
  APPLY_UPDATE: 'invoke:update:apply',

  // 自動更新（main → renderer 廣播）
  /** 進入 dev 模式（不檢查） */
  UPDATE_DEV_MODE: 'broadcast:update:dev-mode',
  /** 開始檢查 */
  UPDATE_CHECKING: 'broadcast:update:checking',
  /** 找到新版本 */
  UPDATE_AVAILABLE: 'broadcast:update:available',
  /** 已是最新 */
  UPDATE_UP_TO_DATE: 'broadcast:update:up-to-date',
  /** 下載進度 0-100 */
  UPDATE_DOWNLOAD_PROGRESS: 'broadcast:update:download-progress',
  /** 下載完成（可呼叫 apply） */
  UPDATE_DOWNLOADED: 'broadcast:update:downloaded',
  /** 更新錯誤 */
  UPDATE_ERROR: 'broadcast:update:error',
} as const;
