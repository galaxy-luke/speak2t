/**
 * Update Manager（P4 Stage 2）
 *
 * 包裝 electron-updater 提供：
 * - 檢查 GitHub Releases 有無新版
 * - 廣播 update 事件給 renderer
 * - 提供下載並安裝
 *
 * 設計：
 * - 用 EventEmitter 對外廣播
 * - dev 模式（app.isPackaged=false）不檢查，emit 'dev-mode'
 * - 失敗不丟 exception，emit 'error'（含 message）
 *
 * 流程：
 *   checkForUpdates()
 *     ↓ 沒新版 → emit 'up-to-date'
 *     ↓ 有新版 → emit 'update-available' (含 version)
 *     ↓ autoUpdater 自動下載
 *     ↓ 下載完成 → emit 'update-downloaded'
 *   downloadAndInstall()
 *     → autoUpdater.quitAndInstall()（app 自動重啟）
 */

import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

export interface UpdateManagerEvents {
  /** dev 模式（不檢查） */
  devMode: () => void;
  /** 已是最新 */
  upToDate: () => void;
  /** 檢查中 */
  checking: () => void;
  /** 找到新版本（info.version = 最新版號） */
  updateAvailable: (info: { version: string; releaseDate?: string }) => void;
  /** 下載進度（0-100） */
  downloadProgress: (percent: number) => void;
  /** 下載完成（可呼叫 quitAndInstall） */
  updateDownloaded: (info: { version: string }) => void;
  /** 錯誤 */
  error: (err: { code: string; message: string }) => void;
}

export declare interface UpdateManager {
  on<U extends keyof UpdateManagerEvents>(event: U, listener: UpdateManagerEvents[U]): this;
  emit<U extends keyof UpdateManagerEvents>(event: U, ...args: Parameters<UpdateManagerEvents[U]>): boolean;
}

export class UpdateManager extends EventEmitter {
  private currentVersion: string;
  private latestVersion: string | null = null;

  constructor(currentVersion: string) {
    super();
    this.currentVersion = currentVersion;
  }

  /**
   * 取得當前版本（從 app.getVersion()）
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * 取得檢查到的最新版本（null = 還沒檢查或無新版）
   */
  getLatestVersion(): string | null {
    return this.latestVersion;
  }

  /**
   * 檢查更新（背景非阻塞）
   *
   * dev 模式（unpacked）→ emit 'dev-mode' 直接返回
   * packaged 模式 → 呼叫 autoUpdater.checkForUpdates()
   */
  checkForUpdates(): void {
    if (!app.isPackaged) {
      this.emit('devMode');
      return;
    }
    this.emit('checking');
    // autoUpdater.checkForUpdates 是 Promise，但 event 已經 wire 好了
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit('error', { code: 'check_failed', message: e.message });
    });
  }

  /**
   * 下載並安裝更新（app 會自動重啟）
   */
  quitAndInstall(): void {
    if (!app.isPackaged) {
      this.emit('error', { code: 'not_packaged', message: 'dev 模式不安裝更新' });
      return;
    }
    autoUpdater.quitAndInstall();
  }

  /**
   * 啟動時 wire autoUpdater 事件到 EventEmitter
   */
  wireAutoUpdaterEvents(): void {
    autoUpdater.autoDownload = true; // 找到新版本自動下載
    autoUpdater.autoInstallOnAppQuit = true; // app quit 時自動安裝

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.latestVersion = info.version;
      this.emit('updateAvailable', {
        version: info.version,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.emit('upToDate');
    });

    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      this.emit('downloadProgress', percent);
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.emit('updateDownloaded', { version: info.version });
    });

    autoUpdater.on('error', (err: Error) => {
      this.emit('error', { code: 'updater_error', message: err.message });
    });
  }
}

/** 單例（在 main 啟動時建立） */
let _updateManager: UpdateManager | null = null;

export function initUpdateManager(): UpdateManager {
  if (!_updateManager) {
    _updateManager = new UpdateManager(app.getVersion());
    _updateManager.wireAutoUpdaterEvents();
  }
  return _updateManager;
}

export function getUpdateManager(): UpdateManager {
  if (!_updateManager) {
    throw new Error('UpdateManager 尚未初始化，請先呼叫 initUpdateManager()');
  }
  return _updateManager;
}
