/**
 * ModelList 子元件（P2 Stage 2 + TOFU commit 6 + 刪除按鈕 commit 8）
 *
 * 顯示模型清單 + 下載 UI + 5 態校驗標籤：
 * - 已下載：✅ + 5 態校驗標籤 + 路徑 + 重新下載/刪除/重新校驗/清除 TOFU 按鈕
 * - 未下載：下載按鈕
 * - 下載中：進度條 + 速度 + 取消按鈕
 * - 完成 / 失敗 / 取消：狀態訊息（5 秒自動消失）
 *
 * 給 AsrTab 內嵌。
 *
 * 重新下載流程（commit: 修 code=5）：
 * 「重新下載」按鈕 = 先 onRemoveModel 刪除既有檔案 → 再 onDownload 重新下載
 * 不再用 --force 或 code=5 hack
 */

import { useState } from 'react';
import type {
  ModelInfo,
  DownloadProgressPayload,
  VerificationResultPayload,
} from '../../../shared/api';
import type { DownloadStatus } from '../hooks/useDownloadState';

interface Props {
  models: ModelInfo[];
  status: DownloadStatus;
  verifications: Record<string, VerificationResultPayload>;
  tofuBaselines: Record<string, { establishedAt: string; sha256: string; sizeBytes: number }>;
  onDownload: (presetKey: string) => void;
  onCancel: () => void;
  onVerify: (presetKey: string) => void;
  onRemoveTofu: (presetKey: string) => void;
  /** 刪除已下載的模型（commit: 刪除模型按鈕 + 修 code=5） */
  onRemoveModel: (presetKey: string) => void;
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

/**
 * 5 態校驗標籤
 * 優先序：mismatch > official-verified > tofu-verified > no-baseline > not-installed
 */
function VerificationBadge({
  model,
  verification,
  hasTofu,
}: {
  model: ModelInfo;
  verification: VerificationResultPayload | undefined;
  hasTofu: boolean;
}) {
  if (!model.installed) {
    return (
      <span className="model-sha256 unverified" title="模型未下載">
        {' '}📦 未下載
      </span>
    );
  }

  // 沒收到 verify event（剛下載完還沒跑 background verify）
  if (!verification) {
    if (model.sha256) {
      return (
        <span className="model-sha256 unverified" title="尚未跑校驗">
          {' '}⏳ 待校驗
        </span>
      );
    }
    if (hasTofu) {
      return (
        <span className="model-sha256 unverified" title="TOFU baseline 已建立，待校驗">
          {' '}⏳ 待校驗
        </span>
      );
    }
    return (
      <span className="model-sha256 unverified" title="無官方 / TOFU baseline，無法校驗">
        {' '}⚠️ 首次使用中
      </span>
    );
  }

  // 收到 verify event → 依 status 渲染
  switch (verification.status) {
    case 'official-verified':
      return (
        <span
          className="model-sha256 verified"
          title={`SHA-256: ${verification.actualHash ?? '?'}`}
        >
          {' '}🔵 官方已驗證
        </span>
      );
    case 'tofu-verified':
      return (
        <span
          className="model-sha256 verified"
          title={`TOFU SHA-256: ${verification.actualHash ?? '?'}`}
        >
          {' '}🟢 TOFU 校驗通過
        </span>
      );
    case 'mismatch':
      return (
        <span
          className="model-sha256 mismatch"
          title={`檔案被竊改 / 損壞\n預期: ${verification.officialSha256 ?? verification.tofuSha256 ?? '?'}\n實際: ${verification.actualHash ?? '?'}\n建議重新下載`}
        >
          {' '}❌ 校驗失敗
        </span>
      );
    case 'no-baseline':
      return (
        <span
          className="model-sha256 unverified"
          title="無官方 / TOFU baseline，無法校驗"
        >
          {' '}⚠️ 首次使用中
        </span>
      );
    case 'not-installed':
      return (
        <span className="model-sha256 unverified" title="模型檔案不存在">
          {' '}📦 未安裝
        </span>
      );
  }
}

function ModelItem({ model, status, verification, hasTofu, onDownload, onCancel, onVerify, onRemoveTofu, onRemoveModel }: {
  model: ModelInfo;
  status: DownloadStatus;
  verification: VerificationResultPayload | undefined;
  hasTofu: boolean;
  onDownload: (k: string) => void;
  onCancel: () => void;
  onVerify: (k: string) => void;
  onRemoveTofu: (k: string) => void;
  /** 刪除已下載的模型（commit: 刪除模型按鈕 + 修 code=5） */
  onRemoveModel: (k: string) => void;
}) {
  const isDownloading = status.kind === 'downloading' && status.preset === model.key;
  const isJustCompleted = status.kind === 'completed' && status.preset === model.key;
  const isJustErrored = status.kind === 'error' && status.preset === model.key;
  const isJustCancelled = status.kind === 'cancelled' && status.preset === model.key;
  const isJustVerified = status.kind === 'verified' && status.preset === model.key;
  const isActive = isDownloading || isJustCompleted || isJustErrored || isJustCancelled || isJustVerified;
  const [isRedownloading, setIsRedownloading] = useState(false);

  /**
   * 「重新下載」按鈕流程（commit: 修 code=5）：
   * 先刪除既有檔案（清掉 TOFU baseline + 目錄）→ 再下載全新的
   * 確保每次按都是乾淨的全新下載，不靠 --force hack
   */
  const handleRedownload = async (key: string) => {
    if (isRedownloading) return;
    setIsRedownloading(true);
    try {
      await onRemoveModel(key);
      await onDownload(key);
    } finally {
      setIsRedownloading(false);
    }
  };

  return (
    <div className={`model-item ${isActive ? 'active' : ''}`}>
      <div className="model-header">
        <div className="model-info">
          <div className="model-name">
            {model.installed ? '✅' : '📦'} {model.name}
            <VerificationBadge model={model} verification={verification} hasTofu={hasTofu} />
          </div>
          <div className="model-desc">{model.description}</div>
          <div className="model-meta">
            <code className="code-mono">{model.path}</code>
            {verification && verification.actualHash && (
              <div className="model-hash">
                實際 SHA-256: <code className="code-mono">{verification.actualHash.slice(0, 16)}…{verification.actualHash.slice(-8)}</code>
                {' '}({formatBytes(verification.fileSize)})
              </div>
            )}
            {hasTofu && (
              <div className="model-hash">
                TOFU baseline：<code className="code-mono">已建立</code>
              </div>
            )}
            {model.sha256 && (
              <div className="model-hash">
                官方 baseline: <code className="code-mono">{model.sha256.slice(0, 16)}…{model.sha256.slice(-8)}</code>
              </div>
            )}
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
              onClick={() => void handleRedownload(model.key)}
              disabled={isActive || isRedownloading}
              title="先刪除既有檔案再重新下載"
            >
              {isRedownloading ? '準備中…' : '重新下載'}
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

      {/* TOFU 操作列（已下載才顯示） */}
      {model.installed && (
        <div className="model-tofu-actions">
          <button
            className="btn btn-tiny"
            onClick={() => onVerify(model.key)}
            disabled={isActive}
            title="重新計算磁碟 SHA-256 並比對 baseline"
          >
            🔄 重新校驗
          </button>
          {hasTofu && !model.sha256 && (
            <button
              className="btn btn-tiny btn-tiny-danger"
              onClick={() => {
                if (confirm(`確定要清除「${model.name}」的 TOFU baseline？\n清除後下次下載會重新建立。`)) {
                  onRemoveTofu(model.key);
                }
              }}
              disabled={isActive}
              title="清除自建 TOFU baseline（懷疑不可信時用）"
            >
              🗑 清除 TOFU
            </button>
          )}
          {/* 刪除整個模型目錄（commit: 刪除模型按鈕） */}
          <button
            className="btn btn-tiny btn-tiny-danger"
            onClick={() => {
              if (
                confirm(
                  `確定要刪除「${model.name}」？\n刪除後需要重新下載才能使用。\n\n模型路徑：${model.path}`,
                )
              ) {
                onRemoveModel(model.key);
              }
            }}
            disabled={isActive}
            title="刪除模型目錄（含 TOFU baseline）"
          >
            🗑 刪除模型
          </button>
        </div>
      )}

      {isDownloading && (
        <DownloadProgressView progress={status.progress} />
      )}

      {isJustVerified && status.kind === 'verified' && !status.skipped && (
        <p className="model-msg success">
          🔒 SHA-256 校驗通過 — <code className="code-mono">{status.actual.slice(0, 16)}…{status.actual.slice(-8)}</code>
        </p>
      )}

      {isJustVerified && status.kind === 'verified' && status.skipped && (
        <p className="model-msg warn">
          ⚠️ 未校驗（無 baseline SHA-256）— 實際：
          <code className="code-mono">{status.actual.slice(0, 16)}…{status.actual.slice(-8)}</code>
        </p>
      )}

      {isJustCompleted && (
        <p className="model-msg success">✓ 下載完成！ASR 引擎已自動重載，可立即使用。</p>
      )}

      {isJustErrored && status.kind === 'error' && (
        <div className="model-msg error">
          <p>
            ⚠️ <strong>下載失敗：{status.message}</strong>
          </p>
          {(status.httpStatus !== undefined || status.cause || status.url || status.expected) && (
            <ul className="error-details">
              {status.httpStatus !== undefined && <li>HTTP status：{status.httpStatus}</li>}
              {status.cause && <li>底層原因：{status.cause}</li>}
              {status.url && <li>URL：<code className="code-mono">{status.url}</code></li>}
              {status.expected && <li>預期 SHA-256：<code className="code-mono">{status.expected}</code></li>}
              {status.actual && status.actual !== status.expected && (
                <li>實際 SHA-256：<code className="code-mono">{status.actual}</code></li>
              )}
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

export function ModelList({
  models,
  status,
  verifications,
  tofuBaselines,
  onDownload,
  onCancel,
  onVerify,
  onRemoveTofu,
  onRemoveModel,
  loading,
}: Props) {
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
          verification={verifications[m.key]}
          hasTofu={m.key in tofuBaselines}
          onDownload={onDownload}
          onCancel={onCancel}
          onVerify={onVerify}
          onRemoveTofu={onRemoveTofu}
          onRemoveModel={onRemoveModel}
        />
      ))}
    </div>
  );
}
