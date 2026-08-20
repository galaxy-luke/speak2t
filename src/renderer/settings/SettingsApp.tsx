/**
 * SettingsApp 頂層（P2 Stage 1）
 *
 * 結構：左側 navbar + 右側內容區
 * - 4 個 tab：一般 / ASR / 麥克風 / 進階
 * - Form draft pattern：修改不立即儲存，按「儲存」才寫磁碟
 * - Top status bar：當前狀態 + 熱鍵觸發計數 + 儲存/取消按鈕
 *
 * 取代 P1 的單頁 SettingsApp（8 個 section 全部展開）。
 */

import { useEffect, useMemo, useState } from 'react';
import type { AppSettings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { GeneralTab } from './tabs/GeneralTab';
import { AsrTab } from './tabs/AsrTab';
import { MicTab } from './tabs/MicTab';
import { AdvancedTab } from './tabs/AdvancedTab';
import { useAsrEvents } from './hooks/useAsrEvents';

type TabId = 'general' | 'asr' | 'mic' | 'advanced';

const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: '一般' },
  { id: 'asr', label: 'ASR' },
  { id: 'mic', label: '麥克風' },
  { id: 'advanced', label: '進階' },
];

export function SettingsApp() {
  // ============= 設定 form draft =============
  const [saved, setSaved] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ============= Tab 狀態 =============
  const [activeTab, setActiveTab] = useState<TabId>('general');

  // ============= 應用程式狀態 =============
  const [hotkeyCount, setHotkeyCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // ============= ASR 狀態（用於 status bar） =============
  const { status } = useAsrEvents();

  // ============= 載入 =============
  useEffect(() => {
    window.speak2t.getSettings().then((s) => {
      setSaved(s);
      setDraft(s);
    });
  }, []);

  // ============= 訂閱熱鍵事件 =============
  useEffect(() => {
    const offRecStart = window.speak2t.onHotkeyRecordStart(() => {
      setHotkeyCount((c) => c + 1);
      setToast('🎙️ 開始錄音');
      setTimeout(() => setToast(null), 1500);
    });
    const offRecStop = window.speak2t.onHotkeyRecordStop(() => {
      setToast('⏹ 停止，辨識中...');
      setTimeout(() => setToast(null), 2000);
    });

    return () => {
      offRecStart();
      offRecStop();
    };
  }, []);

  // ============= isDirty =============
  const isDirty = useMemo(() => {
    if (!draft || !saved) return false;
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }, [draft, saved]);

  // ============= 操作 =============
  const updateDraft = (partial: Partial<AppSettings>) => {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      const updated = await window.speak2t.saveSettings(draft);
      setSaved(updated);
      setDraft(updated);
      setToast('✓ 設定已儲存');
      setTimeout(() => setToast(null), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(`儲存失敗：${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (saved) setDraft({ ...saved });
    setSaveError(null);
  };

  const handleReset = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const updated = await window.speak2t.saveSettings(DEFAULT_SETTINGS);
      setSaved(updated);
      setDraft(updated);
      setToast('✓ 已重置為預設值');
      setTimeout(() => setToast(null), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(`重置失敗：${msg}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ============= 渲染 =============
  if (!draft || !saved) {
    return (
      <div className="app-shell">
        <div className="loading">載入中…</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <nav className="navbar">
        <div className="navbar-brand">🎙️ Speak2T</div>
        <ul className="navbar-tabs">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                className={`navbar-tab ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
                type="button"
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="navbar-footer">
          <span className="version">v0.1.0</span>
        </div>
      </nav>

      <main className="main-content">
        <header className="content-header">
          <div className="status-row">
            <span className={`status-dot status-${status}`} />
            <code>{status}</code>
            <span className="count">熱鍵觸發：{hotkeyCount}</span>
          </div>
          <div className="action-bar">
            {isDirty && <span className="dirty-indicator">● 有未儲存的修改</span>}
            {isDirty && (
              <button
                className="btn btn-cancel"
                onClick={handleCancel}
                disabled={isSaving}
                type="button"
              >
                取消
              </button>
            )}
            <button
              className="btn btn-save"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              type="button"
            >
              {isSaving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </header>

        <div className="tab-content">
          {activeTab === 'general' && <GeneralTab draft={draft} onChange={updateDraft} />}
          {activeTab === 'asr' && <AsrTab draft={draft} onChange={updateDraft} />}
          {activeTab === 'mic' && <MicTab draft={draft} onChange={updateDraft} />}
          {activeTab === 'advanced' && (
            <AdvancedTab saved={saved} onReset={handleReset} />
          )}
        </div>

        {saveError && <p className="error">⚠️ {saveError}</p>}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
