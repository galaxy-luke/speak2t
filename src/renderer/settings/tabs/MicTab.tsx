/**
 * 麥克風 tab（P2 Stage 1）
 *
 * 內容：
 * - enumerateDevices 列表
 * - 選擇預設麥克風
 * - devicechange 自動刷新
 * - 提示：第一次按「測試」取得 label
 */

import type { AppSettings } from '../../../shared/types';
import { useAudioDevices } from '../hooks/useAudioDevices';

interface Props {
  draft: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void;
}

export function MicTab({ draft, onChange }: Props) {
  const audioDevices = useAudioDevices();
  const selectedDevice = audioDevices.find((d) => d.deviceId === draft.audioDeviceId);

  return (
    <div className="tab-pane">
      <h2 className="tab-title">麥克風選擇</h2>

      <section className="form-row">
        <label className="form-label" htmlFor="audio-device">
          預設輸入裝置
        </label>
        <div className="form-control">
          <select
            id="audio-device"
            className="form-select"
            value={draft.audioDeviceId}
            onChange={(e) => onChange({ audioDeviceId: e.target.value })}
          >
            <option value="">（系統預設麥克風）</option>
            {audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `deviceId ${d.deviceId.slice(0, 8)}…`}
              </option>
            ))}
          </select>
          <p className="hint">
            已偵測 {audioDevices.length} 個輸入裝置。插入新裝置時會自動刷新（devicechange event）。
          </p>
        </div>
      </section>

      {selectedDevice && (
        <section className="info-box">
          <h3>目前選擇</h3>
          <dl className="info-dl">
            <dt>名稱</dt>
            <dd>
              <code>{selectedDevice.label || `deviceId ${selectedDevice.deviceId.slice(0, 8)}…`}</code>
            </dd>
            <dt>deviceId</dt>
            <dd>
              <code className="code-mono">{selectedDevice.deviceId}</code>
            </dd>
            <dt>群組</dt>
            <dd>
              <code>{selectedDevice.groupId.slice(0, 8)}…</code>
            </dd>
          </dl>
        </section>
      )}

      <section className="info-box">
        <h3>說明</h3>
        <ul className="info-list">
          <li>瀏覽器基於安全考量，必須先獲得麥克風權限才會顯示完整裝置名稱。</li>
          <li>若 label 顯示為空（deviceId 開頭），請到「ASR」tab 按「開始測試」取得權限後再回來看。</li>
          <li>切換裝置後，下次按熱鍵或測試按鈕時生效。</li>
        </ul>
      </section>
    </div>
  );
}
