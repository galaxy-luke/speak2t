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
      timestamp: number;
    }
  | { kind: 'cancelled'; preset: string; timestamp: number };

export interface UseDownloadStateReturn {
  models: ModelInfo[];
  status: DownloadStatus;
  refresh: () => Promise<void>;
  startDownload: (presetKey: string) => Promise<void>;
  cancelDownload: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useDownloadState(): UseDownloadStateReturn {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [status, setStatus] = useState<DownloadStatus>({ kind: 'idle' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    return () => {
      offProgress();
      offComplete();
      offError();
      offExists();
      offCancelled();
    };
  }, [refresh]);

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

  return { models, status, refresh, startDownload, cancelDownload, loading, error };
}
