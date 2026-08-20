/**
 * useDownloadState hook
 *
 * 封裝模型下載的完整狀態機：
 * - 取得模型清單（installed 狀態）
 * - 觸發下載 / 取消
 * - 訂閱進度、完成、錯誤、exists、cancelled 事件
 *
 * 給 AsrTab 使用。
 */

import { useEffect, useState, useCallback } from 'react';
import type {
  ModelInfo,
  DownloadProgressPayload,
  DownloadCompletePayload,
  DownloadErrorPayload,
  DownloadExistsPayload,
  DownloadCancelledPayload,
  DownloadVerifiedPayload,
  VerificationResultPayload,
  TofuEstablishedPayload,
  TofuRemovedPayload,
} from '../../../shared/api';

export type DownloadStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; preset: string; progress: DownloadProgressPayload }
  | { kind: 'completed'; preset: string; timestamp: number }
  | {
      kind: 'error';
      preset: string;
      message: string;
      url?: string;
      httpStatus?: number;
      cause?: string;
      stack?: string;
      expected?: string;
      actual?: string;
      timestamp: number;
    }
  | { kind: 'cancelled'; preset: string; timestamp: number }
  | {
      /** SHA-256 校驗結果（暫態，下一步會 emit complete） */
      kind: 'verified';
      preset: string;
      actual: string;
      expected: string | null;
      skipped: boolean;
      timestamp: number;
    };

export interface UseDownloadStateReturn {
  models: ModelInfo[];
  status: DownloadStatus;
  /** 每個 preset 的最新校驗結果（key = preset key） */
  verifications: Record<string, VerificationResultPayload>;
  /** 哪些 preset 有 TOFU baseline（key = preset key） */
  tofuBaselines: Record<string, { establishedAt: string; sha256: string; sizeBytes: number }>;
  refresh: () => Promise<void>;
  startDownload: (presetKey: string) => Promise<void>;
  cancelDownload: () => Promise<void>;
  /** 手動對單一模型做校驗 */
  verifyModel: (presetKey: string) => Promise<void>;
  /** 對所有已下載模型做校驗 */
  verifyAll: () => Promise<void>;
  /** 清除某個 preset 的 TOFU baseline */
  removeTofu: (presetKey: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useDownloadState(): UseDownloadStateReturn {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [status, setStatus] = useState<DownloadStatus>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, VerificationResultPayload>>({});
  const [tofuBaselines, setTofuBaselines] = useState<
    Record<string, { establishedAt: string; sha256: string; sizeBytes: number }>
  >({});

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const list = await window.speak2t.listModels();
      setModels(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`listModels failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初次載入
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 訂閱下載事件
  useEffect(() => {
    const offProgress = window.speak2t.onDownloadProgress((data) => {
      setStatus({ kind: 'downloading', preset: data.preset, progress: data });
    });

    const offComplete = window.speak2t.onDownloadComplete((data: DownloadCompletePayload) => {
      setStatus({ kind: 'completed', preset: data.preset, timestamp: data.timestamp });
      // 重新整理模型清單（installed 變 true）
      void refresh();
      // 5 秒後自動回到 idle
      setTimeout(() => {
        setStatus((s) => (s.kind === 'completed' && s.preset === data.preset ? { kind: 'idle' } : s));
      }, 5000);
    });

    const offError = window.speak2t.onDownloadError((data: DownloadErrorPayload) => {
      setStatus({
        kind: 'error',
        preset: data.preset,
        message: data.message,
        url: data.url,
        httpStatus: data.httpStatus,
        cause: data.cause,
        stack: data.stack,
        timestamp: data.timestamp,
      });
    });

    const offExists = window.speak2t.onDownloadExists((_data: DownloadExistsPayload) => {
      // 已存在不算錯誤，只 refresh 清單
      void refresh();
    });

    const offCancelled = window.speak2t.onDownloadCancelled((data: DownloadCancelledPayload) => {
      setStatus({ kind: 'cancelled', preset: data.preset, timestamp: data.timestamp });
      setTimeout(() => {
        setStatus((s) => (s.kind === 'cancelled' && s.preset === data.preset ? { kind: 'idle' } : s));
      }, 3000);
    });

    const offVerified = window.speak2t.onDownloadVerified((data: DownloadVerifiedPayload) => {
      setStatus({
        kind: 'verified',
        preset: data.preset,
        actual: data.actual,
        expected: data.expected,
        skipped: data.skipped,
        timestamp: data.timestamp,
      });
    });

    // TOFU 自我校驗事件
    const offTofuEstablished = window.speak2t.onTofuEstablished((data: TofuEstablishedPayload) => {
      setTofuBaselines((prev) => ({
        ...prev,
        [data.preset]: {
          establishedAt: data.baseline.establishedAt,
          sha256: data.baseline.sha256,
          sizeBytes: data.baseline.sizeBytes,
        },
      }));
    });
    const offTofuRemoved = window.speak2t.onTofuRemoved((data: TofuRemovedPayload) => {
      setTofuBaselines((prev) => {
        const next = { ...prev };
        delete next[data.preset];
        return next;
      });
    });
    const offVerificationResult = window.speak2t.onVerificationResult(
      (data: VerificationResultPayload) => {
        setVerifications((prev) => ({ ...prev, [data.preset]: data }));
      },
    );

    return () => {
      offProgress();
      offComplete();
      offError();
      offExists();
      offCancelled();
      offVerified();
      offTofuEstablished();
      offTofuRemoved();
      offVerificationResult();
    };
  }, [refresh]);

  // 初次載入時從 settings 拿 TOFU baselines
  useEffect(() => {
    void window.speak2t.getSettings().then((s) => {
      const map: typeof tofuBaselines = {};
      for (const [key, t] of Object.entries(s.tofuBaselines)) {
        map[key] = {
          establishedAt: t.establishedAt,
          sha256: t.sha256,
          sizeBytes: t.sizeBytes,
        };
      }
      setTofuBaselines(map);
    });
  }, []);

  const startDownload = useCallback(async (presetKey: string) => {
    setError(null);
    try {
      await window.speak2t.downloadModel(presetKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`downloadModel failed: ${msg}`);
    }
  }, []);

  const cancelDownload = useCallback(async () => {
    try {
      await window.speak2t.cancelDownload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`cancelDownload failed: ${msg}`);
    }
  }, []);

  const verifyModel = useCallback(async (presetKey: string) => {
    setError(null);
    try {
      const result = await window.speak2t.verifyModel(presetKey);
      setVerifications((prev) => ({ ...prev, [presetKey]: result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`verifyModel failed: ${msg}`);
    }
  }, []);

  const verifyAll = useCallback(async () => {
    setError(null);
    try {
      const results = await window.speak2t.verifyAllModels();
      const next: Record<string, VerificationResultPayload> = {};
      for (const r of results) next[r.preset] = r;
      setVerifications(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`verifyAllModels failed: ${msg}`);
    }
  }, []);

  const removeTofu = useCallback(async (presetKey: string) => {
    setError(null);
    try {
      await window.speak2t.removeTofuBaseline(presetKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`removeTofuBaseline failed: ${msg}`);
    }
  }, []);

  return {
    models,
    status,
    verifications,
    tofuBaselines,
    refresh,
    startDownload,
    cancelDownload,
    verifyModel,
    verifyAll,
    removeTofu,
    loading,
    error,
  };
}
