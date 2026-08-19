/**
 * Preload Script
 *
 * 透過 contextBridge 暴露安全的 API 給 renderer。
 * renderer 不能直接 require Node.js 模組。
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { AppSettings } from '../shared/types';
import type { Speak2tApi, HotkeyEventPayload, StatusEventPayload } from '../shared/api';

const api: Speak2tApi = {
  // 設定
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS) as Promise<AppSettings>,
  saveSettings: (partial) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, partial) as Promise<AppSettings>,

  // 視窗控制
  showSettings: () => ipcRenderer.invoke(IPC.SHOW_SETTINGS) as Promise<void>,

  // 事件訂閱（回傳 unsubscribe 函式）
  onHotkeyTriggered: (callback) => {
    const listener = (_event: unknown, data: HotkeyEventPayload) => callback(data);
    ipcRenderer.on(IPC.HOTKEY_TRIGGERED, listener);
    return () => ipcRenderer.removeListener(IPC.HOTKEY_TRIGGERED, listener);
  },

  onStatusChanged: (callback) => {
    const listener = (_event: unknown, data: StatusEventPayload) => callback(data);
    ipcRenderer.on(IPC.STATUS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.STATUS_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld('speak2t', api);
