/**
 * 開機自動啟動管理（P2 Stage 3）
 *
 * 包裝 Electron `app.setLoginItemSettings` 為簡單函式。
 *
 * 行為：
 * - enabled = true：寫入 OS 自動啟動清單（Windows 寫 registry / macOS 寫 LaunchAgent / Linux 寫 .desktop）
 *   - openAsHidden: true，開機時背景啟動不彈主視窗
 * - enabled = false：移除自動啟動
 *
 * 失敗處理：
 * - 不丟 exception，只 console.warn（OS 限制 / 權限問題不該 crash app）
 *
 * 注意：
 * - 必須在 app.whenReady 之後呼叫
 * - 跨平台行為不同，packaged 模式 path 由 Electron 自動推導
 */

import { app } from 'electron';

export interface AutoStartResult {
  ok: boolean;
  message?: string;
}

/**
 * 套用開機自動啟動設定
 */
export function applyAutoStart(enabled: boolean): AutoStartResult {
  try {
    if (enabled) {
      // openAsHidden: 開機時背景啟動（tray 常駐），不彈主視窗
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,
        // path/args 不指定，由 Electron 用當前執行檔
      });
      console.log(`[autostart] 開機自動啟動已啟用（openAsHidden=true）`);
      return { ok: true };
    } else {
      app.setLoginItemSettings({
        openAtLogin: false,
        openAsHidden: false,
      });
      console.log(`[autostart] 開機自動啟動已停用`);
      return { ok: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[autostart] 套用失敗：${msg}`);
    return { ok: false, message: msg };
  }
}

/**
 * 查詢當前 OS 自動啟動狀態
 */
export function getAutoStartEnabled(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (err) {
    console.warn(`[autostart] 查詢失敗：${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
