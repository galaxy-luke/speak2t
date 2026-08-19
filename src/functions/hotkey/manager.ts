/**
 * 全域快捷鍵管理（P0 簡化版）
 *
 * 只負責註冊 / 解除註冊一個全域熱鍵，並在觸發時發出事件。
 * P1 階段會擴充：
 * - 支援 PTT（按下開始、放開停止）vs Toggle 模式
 * - 多組熱鍵
 * - 熱鍵衝突偵測
 */

import { globalShortcut } from 'electron';
import { appState } from '../../main/app-state';
import { IPC } from '../../shared/ipc-channels';
import { getMainWindow } from '../../main/windows';

export class HotkeyManager {
  private currentHotkey: string | null = null;

  /**
   * 註冊全域熱鍵
   * @param accelerator Electron Accelerator 格式，例如 'CommandOrControl+Shift+Space'
   * @returns true 成功，false 失敗（已被佔用）
   */
  register(accelerator: string): boolean {
    this.unregister();

    const ok = globalShortcut.register(accelerator, () => {
      this.onTrigger();
    });

    if (ok) {
      this.currentHotkey = accelerator;
      console.log(`[hotkey] registered: ${accelerator}`);
    } else {
      console.warn(`[hotkey] failed to register: ${accelerator} (may be in use)`);
    }
    return ok;
  }

  unregister(): void {
    if (this.currentHotkey) {
      globalShortcut.unregister(this.currentHotkey);
      console.log(`[hotkey] unregistered: ${this.currentHotkey}`);
      this.currentHotkey = null;
    }
  }

  isRegistered(): boolean {
    return this.currentHotkey !== null;
  }

  private onTrigger(): void {
    console.log('[hotkey] triggered');
    // P0 階段：直接在 console 印，並透過 IPC 通知 settings 視窗
    appState.setStatus('recording');

    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.HOTKEY_TRIGGERED, {
        timestamp: Date.now(),
      });
    }

    // P0 階段：2 秒後自動回到 idle（純測試用）
    setTimeout(() => {
      appState.setStatus('idle');
    }, 2000);
  }
}

/** 單例 */
export const hotkeyManager = new HotkeyManager();
