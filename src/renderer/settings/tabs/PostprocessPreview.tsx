/**
 * PostprocessPreview 子元件（P3 Stage 3）
 *
 * 顯示 5 句範例 ASR 輸出，套用 postprocess 規則後的結果。
 * 讓 user 不需跑真實 ASR 就能驗證 postprocess 設定是否正確。
 *
 * 直接呼叫 postprocess 模組（同 process，無 IPC）。
 */

import { useMemo, useState } from 'react';
import { postprocessWithReport } from '../../../functions/postprocess';

const SAMPLE_TEXTS = [
  { label: '中英混講', text: '我今天meeting蘋果13' },
  { label: '英文夾雜', text: 'apple的很好吃' },
  { label: '多個中英交界', text: '我昨天用Python寫了API' },
  { label: '英文逗號', text: '今天,明天都好' },
  { label: '換行 + 中英', text: '\n我  用 Python\n' },
];

export function PostprocessPreview() {
  const [enabled, setEnabled] = useState(true);

  const results = useMemo(() => {
    return SAMPLE_TEXTS.map((sample) => {
      const report = postprocessWithReport(
        sample.text,
        enabled ? undefined : { disabledRules: ['trim-whitespace', 'cn-en-space', 'cn-digit-space', 'comma-normalize', 'trailing-period', 'collapse-spaces'] },
      );
      return { ...sample, report };
    });
  }, [enabled]);

  return (
    <div className="postprocess-preview">
      <div className="preview-controls">
        <label className="toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="toggle-slider" />
          <span className="toggle-label">
            套用 postprocess 規則 {enabled ? '（開）' : '（關 — 顯示純原始輸出）'}
          </span>
        </label>
      </div>

      <div className="preview-list">
        {results.map((r, i) => (
          <div key={i} className="preview-item">
            <div className="preview-label">{r.label}</div>
            <div className="preview-row">
              <span className="preview-tag">原始</span>
              <code className="preview-text">{r.report.original}</code>
            </div>
            <div className="preview-row">
              <span className="preview-tag tag-processed">後處理</span>
              <code className="preview-text">
                {r.report.changed ? r.report.processed : <em>（無變化）</em>}
              </code>
            </div>
            {r.report.appliedRules.length > 0 && (
              <div className="preview-rules">
                套用：{r.report.appliedRules.map((id) => (
                  <span key={id} className="rule-chip">{id}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="hint">
        這是純前端預覽（直接呼叫 postprocess 函式），不需真實 ASR 即可驗證規則效果。
        規則細節見 <code>src/functions/postprocess/</code>。
      </p>
    </div>
  );
}
