/**
 * ASR tab（P2 Stage 1 + Stage 2）
 *
 * Stage 1 內容：
 * - ASR 引擎選擇（sherpa-onnx / whisper.cpp）
 * - 模型 preset 選擇
 * - 自訂模型路徑
 *
 * Stage 2 內容（待補）：
 * - 模型下載 UI + 進度條
 * - 已下載狀態
 */

import type { AppSettings, AsrEngineType, AsrModelPreset } from '../../../shared/types';
import { AsrTester } from './AsrTester';

interface Props {
  draft: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
}

const ENGINE_OPTIONS: { value: AsrEngineType; label: string; description: string }[] = [
  {
    value: 'sherpa-onnx',
    label: 'sherpa-onnx-streaming（預設）',
    description: '低延遲串流，邊說邊出字，模型小 (~340MB)',
  },
  {
    value: 'whisper-cpp',
    label: 'whisper.cpp（備援）',
    description: '離線批次，台灣腔調品質高，模型較大 (~460MB)',
  },
];

const PRESET_OPTIONS: { value: AsrModelPreset; label: string; engine: AsrEngineType }[] = [
  {
    value: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    label: 'sherpa-onnx-streaming-zh-en（中英混講）',
    engine: 'sherpa-onnx',
  },
  {
    value: 'whisper-small',
    label: 'whisper-small（繁中直出）',
    engine: 'whisper-cpp',
  },
];

export function AsrTab({ draft, onChange }: Props) {
  // 過濾出當前引擎可用的 preset
  const availablePresets = PRESET_OPTIONS.filter((p) => p.engine === draft.asrEngine);

  return (
    <div className="tab-pane">
      <h2 className="tab-title">ASR 設定</h2>

      {/* 引擎選擇 */}
      <section className="form-row">
        <label className="form-label" htmlFor="asr-engine">
          ASR 引擎
        </label>
        <div className="form-control">
          <select
            id="asr-engine"
            className="form-select"
            value={draft.asrEngine}
            onChange={(e) => {
              const newEngine = e.target.value as AsrEngineType;
              // 切換引擎時自動選第一個對應 preset
              const firstPreset = PRESET_OPTIONS.find((p) => p.engine === newEngine);
              onChange({
                asrEngine: newEngine,
                asrModelPreset: firstPreset?.value ?? draft.asrModelPreset,
              });
            }}
          >
            {ENGINE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="hint">
            {ENGINE_OPTIONS.find((o) => o.value === draft.asrEngine)?.description}
          </p>
        </div>
      </section>

      {/* 模型 preset */}
      <section className="form-row">
        <label className="form-label" htmlFor="asr-preset">
          模型 preset
        </label>
        <div className="form-control">
          <select
            id="asr-preset"
            className="form-select"
            value={draft.asrModelPreset}
            onChange={(e) => onChange({ asrModelPreset: e.target.value as AsrModelPreset })}
          >
            {availablePresets.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="hint">
            模型下載與狀態管理在 <strong>P2 Stage 2</strong> 補上（自動下載 UI + 進度條）。
          </p>
        </div>
      </section>

      {/* 自訂模型路徑 */}
      <section className="form-row">
        <label className="form-label" htmlFor="custom-model-path">
          自訂模型路徑
        </label>
        <div className="form-control">
          <input
            id="custom-model-path"
            type="text"
            className="form-input"
            placeholder="留空使用預設下載位置"
            value={draft.customModelPath}
            onChange={(e) => onChange({ customModelPath: e.target.value })}
          />
          <p className="hint">
            預設下載位置：<code>%APPDATA%\speak2t\models\&lt;preset&gt;\</code>
          </p>
        </div>
      </section>

      {/* ASR 測試區 */}
      <AsrTester settings={draft} />
    </div>
  );
}
