/**
 * 全域應用程式狀態
 *
 * 簡單 EventEmitter 模式，主進程內各模組共享狀態。
 * P0 階段先做最簡版，P1 會擴充。
 */

import { EventEmitter } from 'node:events';
import type { AppStatus, AppSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

export class AppState extends EventEmitter {
  private status: AppStatus = 'idle';
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  getStatus(): AppStatus {
    return this.status;
  }

  setStatus(next: AppStatus): void {
    if (this.status === next) return;
    const prev = this.status;
    this.status = next;
    this.emit('status:changed', next, prev);
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.emit('settings:changed', this.settings);
  }
}

/** 單例 */
export const appState = new AppState();
