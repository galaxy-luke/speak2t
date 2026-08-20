/**
 * Settings 主頁面（搬自原 P0 App.tsx）
 *
 * P0：
 * - 顯示目前設定
 * - 監聽熱鍵觸發事件
 *
 * P1 stage 1+2：
 * - mic 擷取按鈕
 * - ASR 結果顯示
 *
 * P1 stage 4：
 * - 改用 onHotkeyRecordStart/Stop 取代 onHotkeyTriggered
 */

import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../../shared/types';
import type { StatusEventPayload } from '../../shared/api';

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<StatusEventPayload['status']>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [hotkeyCount, setHotkeyCount] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  // P1 stage 6.5: 麥克風設備選擇
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);

  const [asrPartial, setAsrPartial] = useState('');
  const [asrFinal, setAsrFinal] = useState('');
  const [asrHistory, setAsrHistory] = useState<string[]>([]);
  const [asrError, setAsrError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    window.speak2t.getSettings().then(setSettings);

    // P1 stage 4：熱鍵觸發改用 record-start/stop
    const offRecStart = window.speak2t.onHotkeyRecordStart(() => {
      setHotkeyCount((c) => c + 1);
      setToast('🎙️ 開始錄音');
      setTimeout(() => setToast(null), 1500);
    });
    const offRecStop = window.speak2t.onHotkeyRecordStop(() => {
      setToast('⏹ 停止，辨識中...');
      setTimeout(() => setToast(null), 2000);
    });

    const offStatus = window.speak2t.onStatusChanged((data) => {
      setStatus(data.status);
    });

    const offLevel = window.speak2t.onIndicatorLevel((data) => {
      setLevel(data.level);
    });

    const offAsrPartial = window.speak2t.onAsrPartial((data) => {
      setAsrPartial(data.text);
      if (data.isEndpoint && data.text) {
        setAsrFinal((prev) => (prev ? `${prev} ${data.text}` : data.text));
      }
    });

    const offAsrFinal = window.speak2t.onAsrFinal((data) => {
      setAsrFinal(data.text);
      setAsrPartial('');
      if (data.text) {
        setAsrHistory((prev) => [
          ...prev,
          `[${new Date(data.timestamp).toLocaleTimeString()}] ${data.text}`,
        ]);
      }
    });

    const offAsrError = window.speak2t.onAsrError((data) => {
      setAsrError(`${data.code}: ${data.message}`);
      setTimeout(() => setAsrError(null), 5000);
    });

    return () => {
      offRecStart();
      offRecStop();
      offStatus();
      offLevel();
      offAsrPartial();
      offAsrFinal();
      offAsrError();
    };
  }, []);

  useEffect(() => {
    return () => {
      stopMicInternal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // P1 stage 6.5: enumerate 麥克風設備 + 監聽 devicechange
  useEffect(() => {
    let cancelled = false;

    async function refreshDevices() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const mics = all.filter((d) => d.kind === 'audioinput');
        setAudioDevices(mics);
      } catch (err) {
        console.warn('[settings] enumerateDevices failed:', err);
      }
    }

    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  /**
   * user 切換麥克風設備
   * 存到 settings.audioDeviceId，下次 startMic 用
   */
  async function handleDeviceChange(deviceId: string) {
    setSettings((prev) => (prev ? { ...prev, audioDeviceId: deviceId } : prev));
    try {
      await window.speak2t.saveSettings({ audioDeviceId: deviceId });
      console.log(`[settings] switched audio device → ${deviceId || '(system default)'}`);
    } catch (err) {
      console.error('[settings] save audio device failed:', err);
    }
  }

  async function startMic() {
    if (isRecording) return;
    setMicError(null);
    setAsrPartial('');
    setAsrFinal('');
    setAsrError(null);

    try {
      // 構建 audio constraints
      // 如果 user 選了特定麥克風，用 deviceId exact
      const audioConstraints: MediaTrackConstraints = {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      };
      if (settings?.audioDeviceId) {
        audioConstraints.deviceId = { exact: settings.audioDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;

      // 第一次成功 getUserMedia 後，label 才會顯示 → 重抓 device 列表
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const mics = all.filter((d) => d.kind === 'audioinput');
        setAudioDevices(mics);
      } catch {
        // ignore
      }

      const sampleRate = 16000;
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule('/audio-worklet.js');

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(audioContext, 'audio-capture-processor');
      workletNodeRef.current = worklet;

      source.connect(worklet);

      worklet.port.onmessage = (event) => {
        const { samples } = event.data as { samples: Float32Array };
        const copy = new Float32Array(samples);
        window.speak2t.sendAudioChunk(copy, sampleRate);
        setChunkCount((c) => c + 1);
      };

      window.speak2t.startRecord();

      setIsRecording(true);
      setChunkCount(0);
      console.log('[renderer] mic started + ASR stream started');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicError(`無法啟動麥克風：${msg}`);
      console.error('[renderer] mic start failed:', err);
    }
  }

  function stopMicInternal() {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function stopMic() {
    stopMicInternal();
    window.speak2t.stopRecord();
    setIsRecording(false);
    setLevel(0);
    console.log('[renderer] mic stopped + ASR stream stopped');
  }

  return (
    <div className="container">
      <h1>🎙️ Speak2T</h1>
      <p className="subtitle">台灣繁體中文語音輸入工具 · P1 stage 1+2+4</p>

      <section className="card">
        <h2>目前狀態</h2>
        <div className="status-row">
          <span className={`status-dot status-${status}`} />
          <code>{status}</code>
        </div>
      </section>

      <section className="card">
        <h2>設定</h2>
        {settings ? (
          <dl>
            <dt>全域熱鍵</dt>
            <dd>
              <code>{settings.hotkey}</code>
            </dd>
            <dt>錄音模式</dt>
            <dd>
              <code>{settings.recordingMode}</code>
            </dd>
            <dt>注入方式</dt>
            <dd>
              <code>{settings.injectionMode}</code>
            </dd>
            <dt>指示器位置</dt>
            <dd>
              <code>{settings.indicatorPosition}</code>
            </dd>
            <dt>ASR 引擎</dt>
            <dd>
              <code>{settings.asrEngine}</code>
            </dd>
            <dt>ASR 模型</dt>
            <dd>
              <code>{settings.asrModelPreset}</code>
            </dd>
            <dt>麥克風</dt>
            <dd>
              <code>
                {(() => {
                  if (!settings.audioDeviceId) return '系統預設';
                  const d = audioDevices.find((d) => d.deviceId === settings.audioDeviceId);
                  return d?.label || `deviceId ${settings.audioDeviceId.slice(0, 8)}…`;
                })()}
              </code>
            </dd>
          </dl>
        ) : (
          <p>載入中…</p>
        )}
      </section>

      <section className="card">
        <h2>🎙️ 麥克風選擇（P1 Stage 6.5）</h2>
        <p>選擇預設麥克風設備，或留空用系統預設：</p>
        <div className="mic-select">
          <select
            className="select-mic"
            value={settings?.audioDeviceId ?? ''}
            onChange={(e) => void handleDeviceChange(e.target.value)}
          >
            <option value="">（系統預設麥克風）</option>
            {audioDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `deviceId ${d.deviceId.slice(0, 8)}…`}
              </option>
            ))}
          </select>
          <span className="count">已偵測 {audioDevices.length} 個輸入裝置</span>
        </div>
        <p className="hint">
          新插入耳機或 USB 麥克風時會自動偵測（devicechange event）。
          完整裝置名稱需先按下「開始」讓瀏覽器取得權限後才會顯示。
        </p>
      </section>

      <section className="card">
        <h2>P1 Stage 4 — Toggle 熱鍵</h2>
        <p>
          按 <kbd>{settings?.hotkey ?? '...'}</kbd> 切換錄音（按一下開始、再按一下停止）。觸發次數：{hotkeyCount}
        </p>
        <p className="hint">P0 「收到熱鍵」toast 已被替換為「開始錄音/停止」semantic toast。</p>
      </section>

      <section className="card">
        <h2>P1 Stage 1+2 — 語音輸入 + ASR（按鈕測試）</h2>
        <p>點按鈕啟動麥克風 + ASR 辨識：</p>
        <div className="mic-test">
          {isRecording ? (
            <button className="btn btn-stop" onClick={stopMic}>
              ⏹ 停止
            </button>
          ) : (
            <button className="btn btn-start" onClick={startMic}>
              🎙️ 開始
            </button>
          )}
          <span className="count">IPC chunks: {chunkCount}</span>
        </div>

        <div className="level-bar">
          <div className="level-fill" style={{ width: `${Math.min(level * 100, 100)}%` }} />
        </div>

        {asrPartial && (
          <div className="asr-partial">
            <span className="label">partial:</span> {asrPartial}
          </div>
        )}

        {asrFinal && (
          <div className="asr-final">
            <span className="label">final:</span> {asrFinal}
          </div>
        )}

        {asrError && <p className="error">⚠️ ASR 錯誤：{asrError}</p>}
        {micError && <p className="error">⚠️ {micError}</p>}

        {asrHistory.length > 0 && (
          <details className="asr-history">
            <summary>歷史辨識結果（{asrHistory.length}）</summary>
            <ul>
              {asrHistory.map((entry, i) => (
                <li key={i}>{entry}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="hint">
          啟用後請允許麥克風權限。需要先下載 ASR 模型才有辨識結果。
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
