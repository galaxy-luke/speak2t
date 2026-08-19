/**
 * IPC channel 名稱常數（main ↔ renderer 通信用）
 *
 * 命名規則：<方向>:<模組>:<動作>
 * - main→renderer: 'broadcast:' 或 'notify:'
 * - renderer→main: 'invoke:' 或 'send:'
 */

export const IPC = {
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
} as const;
