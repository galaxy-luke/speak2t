/**
 * P0 Hello-world 主頁面
 *
 * - 顯示目前設定（從 main 讀取）
 * - 顯示「按 Ctrl+Shift+Space 測試」說明
 * - 監聽熱鍵觸發事件，顯示「收到熱鍵」toast
 */

import { useEffect, useState } from 'react';
import type { AppSettings } from '../shared/types';
import type { StatusEventPayload } from '../shared/api';

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<StatusEventPayload['status']>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [hotkeyCount, setHotkeyCount] = useState(0);

  // 初始化：讀設定、訂閱事件
  useEffect(() => {
    window.speak2t.getSettings().then(setSettings);

    const offHotkey = window.speak2t.onHotkeyTriggered(() => {
      setHotkeyCount((c) => c + 1);
      setToast('🎙️ 收到熱鍵！');
      setTimeout(() => setToast(null), 2000);
    });

    const offStatus = window.speak2t.onStatusChanged((data) => {
      setStatus(data.status);
    });

    return () => {
      offHotkey();
      offStatus();
    };
  }, []);

  return (
    <div className="container">
      <h1>🎙️ Speak2T</h1>
      <p className="subtitle">台灣繁體中文語音輸入工具 · P0 雛形</p>

      <section className="card">
        <h2>目前狀態</h2>
        <div className="status-row">
          <span className={`status-dot status-${status}`} />
          <code>{status}</code>
        </div>
      </section>

      <section className="card">
        <h2>設定</h2>
        {settings ? (
          <dl>
            <dt>全域熱鍵</dt>
            <dd>
              <code>{settings.hotkey}</code>
            </dd>
            <dt>錄音模式</dt>
            <dd>
              <code>{settings.recordingMode}</code>
            </dd>
            <dt>注入方式</dt>
            <dd>
              <code>{settings.injectionMode}</code>
            </dd>
            <dt>指示器位置</dt>
            <dd>
              <code>{settings.indicatorPosition}</code>
            </dd>
          </dl>
        ) : (
          <p>載入中…</p>
        )}
      </section>

      <section className="card">
        <h2>P0 驗證</h2>
        <p>請按全域熱鍵測試：</p>
        <div className="hotkey-test">
          <kbd>{settings?.hotkey ?? '...'}</kbd>
          <span className="count">觸發次數：{hotkeyCount}</span>
        </div>
        <p className="hint">
          按下熱鍵後，視窗會顯示 toast（2 秒後消失），主控台也會印 log。
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
