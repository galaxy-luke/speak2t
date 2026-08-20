/**
 * 進階 tab（P2 Stage 1）
 *
 * 內容：
 * - 應用程式資訊（版本、license、SPEC.md 連結）
 * - 重置設定按鈕（回到 DEFAULT_SETTINGS）
 * - 重置確認 modal
 */

import { useState } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from '../../../shared/types';
import { PostprocessPreview } from './PostprocessPreview';

interface Props {
  saved: AppSettings | null;
  onReset: () => Promise<void>;
}

export function AdvancedTab({ saved, onReset }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="tab-pane">
      <h2 className="tab-title">進階</h2>

      <section className="info-box">
        <h3>關於 Speak2T</h3>
        <dl className="info-dl">
          <dt>版本</dt>
          <dd>
            <code>0.1.0</code>
          </dd>
          <dt>授權</dt>
          <dd>MIT License</dd>
          <dt>目標平台</dt>
          <dd>Windows 11 優先（macOS 後續）</dd>
          <dt>語言焦點</dt>
          <dd>台灣繁體中文（zh-TW）為主，英文混講為輔</dd>
          <dt>隱私</dt>
          <dd>完全本機處理，語音不外送</dd>
        </dl>
      </section>

      <section className="info-box">
        <h3>設定檔位置</h3>
        <p>
          設定儲存於 <code>%APPDATA%\speak2t\settings.json</code>，模型儲存於{' '}
          <code>%APPDATA%\speak2t\models\&lt;preset&gt;\</code>。
        </p>
      </section>

      <section className="info-box">
        <h3>後處理規則預覽（P3 Stage 3）</h3>
        <p>預覽 5 句範例套用 postprocess 規則前後的對比。</p>
        <PostprocessPreview />
      </section>

      <section className="info-box danger-zone">
        <h3>危險區</h3>
        <p>重置所有設定到預設值（熱鍵、模式、引擎、麥克風選擇、開機啟動都會被清除）。模型檔案不受影響。</p>
        {!confirming ? (
          <button className="btn btn-danger" onClick={() => setConfirming(true)}>
            重置設定…
          </button>
        ) : (
          <div className="confirm-row">
            <span className="confirm-text">確定要重置嗎？此操作無法復原。</span>
            <button className="btn btn-cancel" onClick={() => setConfirming(false)}>
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await onReset();
                setConfirming(false);
              }}
            >
              確認重置
            </button>
          </div>
        )}
        {saved && JSON.stringify(saved) === JSON.stringify(DEFAULT_SETTINGS) && (
          <p className="hint">目前已是預設值。</p>
        )}
      </section>
    </div>
  );
}
