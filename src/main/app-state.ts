/**
 * 全域應用程式狀態
 *
 * 簡單 EventEmitter 模式，主進程內各模組共享狀態。
 * 設定持久化到 userData/settings.json。
 */

import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import type { AppStatus, AppSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

/** 設定檔路徑：<userData>/settings.json */
function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** 從磁碟讀設定（檔案不存在或解析失敗則用 DEFAULT_SETTINGS） */
function loadSettingsFromDisk(): AppSettings {
  const path = getSettingsPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    // 合併預設值，避免新欄位缺失
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (err) {
    console.warn(`[app-state] 設定檔讀取失敗（${path}）：${err instanceof Error ? err.message : String(err)}`);
    return { ...DEFAULT_SETTINGS };
  }
}

/** 寫設定到磁碟（靜默失敗，log warning） */
function saveSettingsToDisk(settings: AppSettings): void {
  try {
    const path = getSettingsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[app-state] 設定檔寫入失敗：${err instanceof Error ? err.message : String(err)}`);
  }
}

export class AppState extends EventEmitter {
  private status: AppStatus = 'idle';
  private settings: AppSettings;

  constructor() {
    super();
    this.settings = loadSettingsFromDisk();
    console.log(`[app-state] 載入設定：hotkey=${this.settings.hotkey}, engine=${this.settings.asrEngine}, preset=${this.settings.asrModelPreset}`);
  }

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
    // 同步寫到磁碟
    saveSettingsToDisk(this.settings);
  }
}

/** 單例 */
export const appState = new AppState();
