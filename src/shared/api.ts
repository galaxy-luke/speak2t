/**
 * 跨進程的 API 介面定義
 *
 * 這個型別同時在：
 * - preload/index.ts 實作（透過 contextBridge 暴露）
 * - renderer 端透過 globalThis.speak2t 使用
 *
 * 確保 main / preload / renderer 三方對 API shape 有一致共識。
 */

import type { AppSettings } from './types';

export interface Speak2tApi {
  // 設定
  getSettings: () => Promise<AppSettings>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;

  // 視窗控制
  showSettings: () => Promise<void>;

  // 事件訂閱
  onHotkeyTriggered: (callback: (data: HotkeyEventPayload) => void) => () => void;
  onStatusChanged: (callback: (data: StatusEventPayload) => void) => () => void;
}

export interface HotkeyEventPayload {
  timestamp: number;
}

export interface StatusEventPayload {
  status: 'idle' | 'recording' | 'processing' | 'paused';
}

declare global {
  interface Window {
    speak2t: Speak2tApi;
  }
}
