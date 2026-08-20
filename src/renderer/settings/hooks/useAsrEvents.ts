/**
 * useAsrEvents hook
 *
 * 訂閱 ASR 事件（partial / final / error / level / status），回傳 state 給 UI 用。
 * 給 SettingsApp 跟 AsrTester 共用。
 */

import { useEffect, useState } from 'react';
import type {
  AsrPartialPayload,
  AsrFinalPayload,
  AsrErrorPayload,
  StatusEventPayload,
  IndicatorLevelPayload,
} from '../../../shared/api';

export interface AsrEventState {
  status: StatusEventPayload['status'];
  level: number;
  partial: string;
  final: string;
  history: string[];
  error: string | null;
}

export function useAsrEvents(): AsrEventState {
  const [status, setStatus] = useState<StatusEventPayload['status']>('idle');
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const [final, setFinal] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const offStatus = window.speak2t.onStatusChanged((data) => {
      setStatus(data.status);
      // 狀態回到 idle 時自動歸零音量
      if (data.status === 'idle') {
        setLevel(0);
      }
    });
    const offLevel = window.speak2t.onIndicatorLevel((data: IndicatorLevelPayload) => {
      setLevel(data.level);
    });
    const offPartial = window.speak2t.onAsrPartial((data: AsrPartialPayload) => {
      setPartial(data.text);
    });
    const offFinal = window.speak2t.onAsrFinal((data: AsrFinalPayload) => {
      setFinal(data.text);
      setPartial('');
      if (data.text) {
        setHistory((prev) => [
          ...prev,
          `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.text}`,
        ]);
      }
    });
    const offError = window.speak2t.onAsrError((data: AsrErrorPayload) => {
      setError(`${data.code}: ${data.message}`);
      setTimeout(() => setError(null), 5000);
    });

    return () => {
      offStatus();
      offLevel();
      offPartial();
      offFinal();
      offError();
    };
  }, []);

  return { status, level, partial, final, history, error };
}
