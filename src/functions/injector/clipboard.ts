/**
 * ClipboardInjector
 *
 * 把 ASR 最終文字注入到當前焦點視窗。
 *
 * 兩種模式（D-C 決策）：
 * - 'clipboard'：純寫剪貼簿，user 手動 Ctrl+V
 * - 'clipboard-and-paste'：寫剪貼簿 + 自動 SendKeys Ctrl+V（預設）
 *
 * 設計：
 * 1. 備份原剪貼簿
 * 2. 寫入新文字
 * 3. （clipboard-and-paste 模式）SendKeys Ctrl+V
 * 4. 等 200ms 後還原剪貼簿（給目標 app 時間貼上）
 *
 * 已知風險：
 * - PowerShell SendKeys 可能被防毒 / UAC 視窗擋
 * - 焦點必須在可貼上的視窗（否則 Ctrl+V 送錯地方）
 * - 200ms 還原可能太短 / 太長
 */

import { clipboard } from 'electron';
import { spawn } from 'node:child_process';
import type { InjectionMode } from '../../shared/types';

export interface InjectionResult {
  ok: boolean;
  /** 注入的文字（可能經過 trim） */
  text: string;
  /** 失敗時的原因 */
  reason?: string;
}

export class ClipboardInjector {
  /**
   * 注入文字到當前焦點視窗
   * @param text 要注入的文字
   * @param mode 注入模式（clipboard / clipboard-and-paste）
   */
  async inject(text: string, mode: InjectionMode): Promise<InjectionResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { ok: false, text: '', reason: 'empty text' };
    }

    // 1. 備份原剪貼簿
    const original = this.readClipboardSafe();

    // 2. 寫入新文字
    try {
      clipboard.writeText(trimmed);
    } catch (err) {
      return {
        ok: false,
        text: trimmed,
        reason: `clipboard write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (mode === 'clipboard') {
      // 純剪貼簿模式：不還原（讓 user 手動貼上後自己決定是否清空）
      console.log(`[injector] clipboard mode: text written (${trimmed.length} chars), user 手動 Ctrl+V`);
      return { ok: true, text: trimmed };
    }

    // clipboard-and-paste 模式：SendKeys + 還原剪貼簿
    try {
      await this.sendCtrlV();
      console.log(`[injector] clipboard-and-paste: sent Ctrl+V (${trimmed.length} chars)`);

      // 等 200ms 給目標 app 貼上
      await this.sleep(200);

      // 還原剪貼簿
      if (original !== null) {
        try {
          clipboard.writeText(original);
        } catch (err) {
          // 還原失敗不影響 inject 結果（已成功貼上）
          console.warn(`[injector] failed to restore clipboard: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { ok: true, text: trimmed };
    } catch (err) {
      // SendKeys 失敗：文字還在剪貼簿，user 可手動 Ctrl+V
      return {
        ok: false,
        text: trimmed,
        reason: `SendKeys failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * 讀剪貼簿（捕獲 readText 偶爾的 IPC 錯誤）
   */
  private readClipboardSafe(): string | null {
    try {
      return clipboard.readText();
    } catch (err) {
      console.warn(`[injector] failed to read clipboard: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * 用 PowerShell SendKeys 送 Ctrl+V
   * 用 System.Windows.Forms.SendKeys.SendWait('^v')（^ = Ctrl）
   */
  private async sendCtrlV(): Promise<void> {
    return new Promise((resolve, reject) => {
      // PowerShell script：
      // - Add-Type 載入 System.Windows.Forms
      // - SendWait 同步送按鍵（vs Send 不同步）
      // - ^v = Ctrl+V
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        "[System.Windows.Forms.SendKeys]::SendWait('^v')",
      ].join('; ');

      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          windowsHide: true, // 不顯示 PowerShell 視窗
        },
      );

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      ps.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ps.on('error', (err) => {
        reject(new Error(`spawn failed: ${err.message}`));
      });

      ps.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SendKeys exited with code=${code}, stderr: ${stderr.trim() || 'none'}`));
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Singleton instance */
export const clipboardInjector = new ClipboardInjector();
