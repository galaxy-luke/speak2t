/**
 * ModelList 子元件（P2 Stage 2）
 *
 * 顯示模型清單 + 下載 UI：
 * - 已下載：打勾 + 路徑 + 重新下載按鈕
 * - 未下載：下載按鈕
 * - 下載中：進度條 + 速度 + 取消按鈕
 * - 完成 / 失敗 / 取消：狀態訊息（5 秒自動消失）
 *
 * 給 AsrTab 內嵌。
 */

import type { ModelInfo, DownloadProgressPayload } from '../../../shared/api';
import type { DownloadStatus } from '../hooks/useDownloadState';

interface Props {
  models: ModelInfo[];
  status: DownloadStatus;
  onDownload: (presetKey: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${s}s`;
}

function ModelItem({ model, status, onDownload, onCancel }: {
  model: ModelInfo;
  status: DownloadStatus;
  onDownload: (k: string) => void;
  onCancel: () => void;
}) {
  const isDownloading = status.kind === 'downloading' && status.preset === model.key;
  const isJustCompleted = status.kind === 'completed' && status.preset === model.key;
  const isJustErrored = status.kind === 'error' && status.preset === model.key;
  const isJustCancelled = status.kind === 'cancelled' && status.preset === model.key;
  const isActive = isDownloading || isJustCompleted || isJustErrored || isJustCancelled;

  return (
    <div className={`model-item ${isActive ? 'active' : ''}`}>
      <div className="model-header">
        <div className="model-info">
          <div className="model-name">
            {model.installed ? '✅' : '📦'} {model.name}
          </div>
          <div className="model-desc">{model.description}</div>
          <div className="model-meta">
            <code className="code-mono">{model.path}</code>
          </div>
        </div>
        <div className="model-action">
          {isDownloading ? (
            <button className="btn btn-cancel" onClick={onCancel}>
              取消
            </button>
          ) : model.installed ? (
            <button
              className="btn btn-cancel"
              onClick={() => onDownload(model.key)}
              disabled={isActive}
            >
              重新下載
            </button>
          ) : (
            <button
              className="btn btn-save"
              onClick={() => onDownload(model.key)}
              disabled={isActive}
            >
              下載
            </button>
          )}
        </div>
      </div>

      {isDownloading && (
        <DownloadProgressView progress={status.progress} />
      )}

      {isJustCompleted && (
        <p className="model-msg success">✓ 下載完成！ASR 引擎已自動重載，可立即使用。</p>
      )}

      {isJustErrored && status.kind === 'error' && (
        <div className="model-msg error">
          <p>
            ⚠️ <strong>下載失敗：{status.message}</strong>
          </p>
          {(status.httpStatus !== undefined || status.cause || status.url) && (
            <ul className="error-details">
              {status.httpStatus !== undefined && <li>HTTP status：{status.httpStatus}</li>}
              {status.cause && <li>底層原因：{status.cause}</li>}
              {status.url && <li>URL：<code className="code-mono">{status.url}</code></li>}
            </ul>
          )}
        </div>
      )}

      {isJustCancelled && (
        <p className="model-msg">下載已取消</p>
      )}
    </div>
  );
}

function DownloadProgressView({ progress }: { progress: DownloadProgressPayload }) {
  // 下載階段才顯示進度條
  if (progress.phase === 'downloading' && progress.total > 0) {
    return (
      <div className="download-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(progress.percent, 100)}%` }} />
        </div>
        <div className="progress-info">
          <span>{progress.percent.toFixed(1)}%</span>
          <span>
            {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
          </span>
          {progress.speedBps > 0 && <span>{formatSpeed(progress.speedBps)}</span>}
          {progress.remainingSec > 0 && <span>剩 {formatTime(progress.remainingSec)}</span>}
        </div>
      </div>
    );
  }

  // 解壓 / cleanup 階段
  return (
    <div className="download-progress">
      <div className="progress-bar">
        <div className="progress-fill indeterminate" />
      </div>
      <p className="progress-message">
        {progress.message ?? progress.phase}
      </p>
    </div>
  );
}

export function ModelList({ models, status, onDownload, onCancel, loading }: Props) {
  if (loading && models.length === 0) {
    return <p className="hint">載入模型清單中…</p>;
  }
  if (models.length === 0) {
    return <p className="hint">沒有可用模型</p>;
  }

  return (
    <div className="model-list">
      {models.map((m) => (
        <ModelItem
          key={m.key}
          model={m}
          status={status}
          onDownload={onDownload}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
}
