/**
 * UpdateChecker 子元件（P4 Stage 2）
 *
 * 顯示當前版本 + 檢查更新按鈕 + 進度條 + 套用按鈕
 * 訂閱 window.speak2t 的 update 事件
 */

import { useEffect, useState } from 'react';
import type {
  UpdateAvailablePayload,
  UpdateUpToDatePayload,
  UpdateDownloadProgressPayload,
  UpdateDownloadedPayload,
  UpdateErrorPayload,
} from '../../../shared/api';

interface Props {
  currentVersion: string; // 從 AppSettings 帶進來，或從 IPC 拿
}

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'dev-mode' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export function UpdateChecker({ currentVersion }: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    const offDevMode = window.speak2t.onUpdateDevMode((data) => {
      setStatus({ kind: 'dev-mode' });
      console.log(`[UpdateChecker] dev mode (current v${data.currentVersion})`);
    });

    const offChecking = window.speak2t.onUpdateChecking(() => {
      setStatus({ kind: 'checking' });
    });

    const offAvailable = window.speak2t.onUpdateAvailable((data: UpdateAvailablePayload) => {
      setStatus({ kind: 'available', version: data.version });
    });

    const offUpToDate = window.speak2t.onUpdateUpToDate((_data: UpdateUpToDatePayload) => {
      setStatus({ kind: 'up-to-date' });
      setTimeout(() => {
        setStatus((s) => (s.kind === 'up-to-date' ? { kind: 'idle' } : s));
      }, 5000);
    });

    const offProgress = window.speak2t.onUpdateDownloadProgress((data: UpdateDownloadProgressPayload) => {
      setStatus((s) => {
        if (s.kind === 'available' || s.kind === 'downloading') {
          return { kind: 'downloading', percent: data.percent, version: s.version };
        }
        return s;
      });
    });

    const offDownloaded = window.speak2t.onUpdateDownloaded((data: UpdateDownloadedPayload) => {
      setStatus({ kind: 'downloaded', version: data.version });
    });

    const offError = window.speak2t.onUpdateError((data: UpdateErrorPayload) => {
      setStatus({ kind: 'error', message: `${data.code}: ${data.message}` });
      setTimeout(() => {
        setStatus((s) => (s.kind === 'error' ? { kind: 'idle' } : s));
      }, 5000);
    });

    return () => {
      offDevMode();
      offChecking();
      offAvailable();
      offUpToDate();
      offDownloaded();
      offError();
      offProgress();
    };
  }, []);

  async function handleCheck() {
    setStatus({ kind: 'checking' });
    try {
      await window.speak2t.checkForUpdate();
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleApply() {
    try {
      await window.speak2t.applyUpdate();
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="update-checker">
      <div className="update-header">
        <span className="update-label">當前版本</span>
        <code className="update-version">v{currentVersion}</code>
        <button
          className="btn btn-save"
          onClick={handleCheck}
          disabled={status.kind === 'checking'}
          type="button"
        >
          {status.kind === 'checking' ? '檢查中…' : '檢查更新'}
        </button>
      </div>

      {status.kind === 'dev-mode' && (
        <p className="update-msg info">ℹ️ dev 模式不會檢查更新（只對 packaged app 有效）</p>
      )}

      {status.kind === 'up-to-date' && (
        <p className="update-msg success">✓ 已是最新版本</p>
      )}

      {status.kind === 'available' && (
        <div className="update-msg available">
          🎉 發現新版本 v{status.version}，自動下載中…
        </div>
      )}

      {status.kind === 'downloading' && (
        <div className="update-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${status.percent}%` }} />
          </div>
          <div className="progress-info">
            <span>v{status.version}</span>
            <span>{status.percent}%</span>
          </div>
        </div>
      )}

      {status.kind === 'downloaded' && (
        <div className="update-msg downloaded">
          <span>✓ v{status.version} 下載完成，點下方按鈕重啟安裝</span>
          <button className="btn btn-save" onClick={handleApply} type="button">
            重啟並安裝
          </button>
        </div>
      )}

      {status.kind === 'error' && (
        <p className="update-msg error">⚠️ {status.message}</p>
      )}
    </div>
  );
}
