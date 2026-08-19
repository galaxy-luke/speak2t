/**
 * 全域常數
 */

/** 應用程式基本資訊 */
export const APP_NAME = 'Speak2T';
export const APP_VERSION = '0.1.0';

/** 預設全域快捷鍵 — 使用 Electron 的 Accelerator 格式 */
export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space';

/** 預設熱鍵模式 */
export const DEFAULT_RECORDING_MODE: 'ptt' | 'toggle' = 'ptt';

/** 預設注入策略 */
export const DEFAULT_INJECTION_MODE: 'clipboard' | 'keystroke' = 'clipboard';

/** 預設指示器位置 */
export const DEFAULT_INDICATOR_POSITION: 'bottom-center' | 'follow-cursor' = 'bottom-center';
