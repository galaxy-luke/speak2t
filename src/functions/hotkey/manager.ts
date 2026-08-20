/**
 * 全域快捷鍵管理
 *
 * P0 階段：純測試，觸發就切 recording 2 秒後回 idle
 * P1 階段 4：改為 toggle 模式（D-A 決策）
 *   - 第一次按：toggle 進入 recording，廣播 HOTKEY_RECORD_START
 *   - 第二次按：toggle 回到 idle，廣播 HOTKEY_RECORD_STOP
 *   - 真正的 startRecord/stopRecord 邏輯在 main/index.ts 監聽 broadcast 後執行
 *
 * 未來擴充（D-A + P1+1）：
 * - PTT 模式（uiohook-napi key down/up 事件）
 * - 多組熱鍵
 * - 熱鍵衝突偵測
 */

import { BrowserWindow, globalShortcut } from 'electron';
import { EventEmitter } from 'node:events';
import { IPC } from '../../shared/ipc-channels';

export interface HotkeyManagerEvents {
  /** toggle 切換（isRecording 是新狀態） */
  toggle: (data: { isRecording: boolean; timestamp: number }) => void;
}

export declare interface HotkeyManager {
  on<U extends keyof HotkeyManagerEvents>(event: U, listener: HotkeyManagerEvents[U]): this;
  emit<U extends keyof HotkeyManagerEvents>(event: U, ...args: Parameters<HotkeyManagerEvents[U]>): boolean;
  off<U extends keyof HotkeyManagerEvents>(event: U, listener: HotkeyManagerEvents[U]): this;
}

export class HotkeyManager extends EventEmitter {
  private currentHotkey: string | null = null;
  private isRecording = false;

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

  /**
   * 切換內部 recording 狀態並 emit 事件
   * main 端訂閱此事件後執行真正的 record/stop 邏輯
   */
  private onTrigger(): void {
    this.isRecording = !this.isRecording;
    const timestamp = Date.now();

    if (this.isRecording) {
      console.log('[hotkey] → recording (toggle ON)');
    } else {
      console.log('[hotkey] → idle (toggle OFF)');
    }

    // 廣播到所有 renderer（給 UI 用：toast、indicator）
    this.broadcast(
      this.isRecording ? IPC.HOTKEY_RECORD_START : IPC.HOTKEY_RECORD_STOP,
      { timestamp },
    );

    // emit 內部事件給 main 端（執行業務邏輯：start asr、stop asr、inject）
    this.emit('toggle', { isRecording: this.isRecording, timestamp });
  }

  /**
   * 廣播到所有 renderer
   */
  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  /** 對外暴露：取得當前 recording 狀態（給 main 端查） */
  getRecording(): boolean {
    return this.isRecording;
  }

  /** 對外暴露：強制設回 idle（用於 app 啟動時 reset） */
  resetIdle(): void {
    if (this.isRecording) {
      this.isRecording = false;
    }
  }
}

/** 單例 */
export const hotkeyManager = new HotkeyManager();
