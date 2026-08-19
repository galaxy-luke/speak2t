/**
 * 共用型別定義
 */

/** 應用程式狀態（全域） */
export type AppStatus = 'idle' | 'recording' | 'processing' | 'paused';

/** 錄音模式 */
export type RecordingMode = 'ptt' | 'toggle';

/** 注入策略 */
export type InjectionMode = 'clipboard' | 'keystroke';

/** 指示器位置策略 */
export type IndicatorPosition = 'bottom-center' | 'follow-cursor';

/** 使用者設定 */
export interface AppSettings {
  hotkey: string;
  recordingMode: RecordingMode;
  injectionMode: InjectionMode;
  indicatorPosition: IndicatorPosition;
  autoStart: boolean;
}

/** 預設設定 */
export const DEFAULT_SETTINGS: AppSettings = {
  hotkey: 'CommandOrControl+Shift+Space',
  recordingMode: 'ptt',
  injectionMode: 'clipboard',
  indicatorPosition: 'bottom-center',
  autoStart: false,
};
