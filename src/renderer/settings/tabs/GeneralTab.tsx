/**
 * 一般 tab（P2 Stage 1）
 *
 * 內容：
 * - 熱鍵（純顯示，P2 不做 UI 編輯）
 * - 錄音模式（ptt / toggle）
 * - 注入方式（clipboard / clipboard-and-paste）
 * - 指示器位置（bottom-center / follow-cursor）
 * - 開機自動啟動（toggle）
 */

import type { AppSettings } from '../../../shared/types';

interface Props {
  draft: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
}

export function GeneralTab({ draft, onChange }: Props) {
  return (
    <div className="tab-pane">
      <h2 className="tab-title">一般設定</h2>

      {/* 熱鍵（純顯示） */}
      <section className="form-row">
        <label className="form-label">全域熱鍵</label>
        <div className="form-control">
          <input
            type="text"
            className="form-input"
            value={draft.hotkey}
            disabled
            readOnly
          />
          <p className="hint">目前 P2 階段不支援 UI 編輯熱鍵，需手動編輯 <code>settings.json</code>（未來支援）</p>
        </div>
      </section>

      {/* 錄音模式 */}
      <section className="form-row">
        <label className="form-label" htmlFor="recording-mode">
          錄音模式
        </label>
        <div className="form-control">
          <select
            id="recording-mode"
            className="form-select"
            value={draft.recordingMode}
            onChange={(e) => onChange({ recordingMode: e.target.value as AppSettings['recordingMode'] })}
          >
            <option value="toggle">切換（Toggle）：按一下開始、再按一下停止</option>
            <option value="ptt">長壓（PTT）：按住時錄音，放開停止（需 native hook，P1+1 規劃中）</option>
          </select>
        </div>
      </section>

      {/* 注入方式 */}
      <section className="form-row">
        <label className="form-label" htmlFor="injection-mode">
          文字注入方式
        </label>
        <div className="form-control">
          <select
            id="injection-mode"
            className="form-select"
            value={draft.injectionMode}
            onChange={(e) => onChange({ injectionMode: e.target.value as AppSettings['injectionMode'] })}
          >
            <option value="clipboard-and-paste">剪貼簿 + 自動 Ctrl+V（推薦）</option>
            <option value="clipboard">純寫剪貼簿（手動 Ctrl+V）</option>
          </select>
          <p className="hint">「自動 Ctrl+V」會備份原剪貼簿 200ms 後還原。</p>
        </div>
      </section>

      {/* 指示器位置 */}
      <section className="form-row">
        <label className="form-label" htmlFor="indicator-position">
          指示器位置
        </label>
        <div className="form-control">
          <select
            id="indicator-position"
            className="form-select"
            value={draft.indicatorPosition}
            onChange={(e) => onChange({ indicatorPosition: e.target.value as AppSettings['indicatorPosition'] })}
          >
            <option value="bottom-center">螢幕底部中央（推薦）</option>
            <option value="follow-cursor">跟隨游標</option>
          </select>
        </div>
      </section>

      {/* 開機自動啟動 */}
      <section className="form-row">
        <label className="form-label" htmlFor="auto-start">
          開機自動啟動
        </label>
        <div className="form-control">
          <label className="toggle">
            <input
              id="auto-start"
              type="checkbox"
              checked={draft.autoStart}
              onChange={(e) => onChange({ autoStart: e.target.checked })}
            />
            <span className="toggle-slider" />
            <span className="toggle-label">
              {draft.autoStart ? '已啟用（開機自動啟動，tray 常駐）' : '未啟用'}
            </span>
          </label>
          <p className="hint">寫入 Windows 登錄檔 <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code>，開機時背景啟動。</p>
        </div>
      </section>
    </div>
  );
}
