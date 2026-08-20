/**
 * Indicator 浮窗 UI（stage 4）
 *
 * 顯示：
 * - 狀態圖示（idle/recording/processing/error）
 * - 音量條
 * - ASR partial 文字（最多一行）
 *
 * frameless + transparent，固定 360x80
 */

import { useEffect, useState } from 'react';
import type { StatusEventPayload } from '../../shared/api';

type State = 'idle' | 'recording' | 'processing' | 'error';

const STATE_LABEL: Record<State, string> = {
  idle: '待機',
  recording: '錄音中',
  processing: '辨識中',
  error: '錯誤',
};

export function IndicatorApp() {
  const [state, setState] = useState<State>('idle');
  const [level, setLevel] = useState(0);
  const [text, setText] = useState('');

  useEffect(() => {
    const offStatus = window.speak2t.onStatusChanged((data: StatusEventPayload) => {
      setState(data.status as State);
    });
    const offLevel = window.speak2t.onIndicatorLevel((data) => {
      setLevel(data.level);
    });
    const offText = window.speak2t.onIndicatorText((data) => {
      setText(data.text);
    });

    return () => {
      offStatus();
      offLevel();
      offText();
    };
  }, []);

  // 處理中時自動 fade out
  useEffect(() => {
    if (state === 'idle') {
      setText('');
    }
  }, [state]);

  return (
    <div className={`indicator indicator-${state}`}>
      <div className="indicator-card">
        <div className="indicator-row">
          <span className={`indicator-dot indicator-dot-${state}`} />
          <span className="indicator-state">{STATE_LABEL[state]}</span>
          {state === 'recording' && (
            <div className="indicator-level">
              <div className="indicator-level-fill" style={{ width: `${Math.min(level * 100, 100)}%` }} />
            </div>
          )}
        </div>
        {text && state !== 'idle' && <div className="indicator-text">{text}</div>}
      </div>
    </div>
  );
}
