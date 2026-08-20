/**
 * AsrTester 子元件（P2 Stage 1）
 *
 * 從原 SettingsApp 拆出的 mic 擷取 + ASR 顯示區塊。
 * 給 AsrTab 內嵌使用。
 *
 * 行為：
 * - 點「開始」→ getUserMedia + AudioWorklet + IPC chunk 推送
 * - 點「停止」→ 停止 stream + IPC stopRecord
 * - 顯示即時音量、partial、final、history
 * - 卸載時自動清理
 */

import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../../../shared/types';
import { useAsrEvents } from '../hooks/useAsrEvents';
import type { AsrPostprocessedPayload } from '../../../shared/api';

interface Props {
  settings: AppSettings;
}

export function AsrTester({ settings }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [postprocessReport, setPostprocessReport] = useState<AsrPostprocessedPayload | null>(null);
  const { level, partial, final, history, error } = useAsrEvents();

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  useEffect(() => {
    return () => {
      stopMicInternal();
    };
  }, []);

  // P3 Stage 3：訂閱 ASR_POSTPROCESSED 顯示後處理結果
  useEffect(() => {
    const off = window.speak2t.onAsrPostprocessed((data) => {
      setPostprocessReport(data);
      // 5 秒後自動清掉（讓下次有空間）
      setTimeout(() => {
        setPostprocessReport((prev) => (prev?.timestamp === data.timestamp ? null : prev));
      }, 10000);
    });
    return off;
  }, []);

  async function startMic() {
    if (isRecording) return;
    setMicError(null);
    // partial / final / history 由 useAsrEvents hook 管理，停止時自動清

    try {
      const audioConstraints: MediaTrackConstraints = {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      };
      if (settings.audioDeviceId) {
        audioConstraints.deviceId = { exact: settings.audioDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;

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
      console.log('[AsrTester] mic started');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMicError(`無法啟動麥克風：${msg}`);
      console.error('[AsrTester] mic start failed:', err);
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
    // level 由 useAsrEvents 在 status 變 idle 時自動歸零
    console.log('[AsrTester] mic stopped');
  }

  return (
    <section className="tester-section">
      <h3>ASR 測試</h3>
      <p className="hint">不透過熱鍵，直接點按鈕測試麥克風擷取 + ASR 辨識。</p>

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

      {partial && (
        <div className="asr-partial">
          <span className="label">partial:</span> {partial}
        </div>
      )}

      {final && (
        <div className="asr-final">
          <span className="label">final:</span> {final}
        </div>
      )}

      {postprocessReport && postprocessReport.changed && (
        <div className="postprocess-compare">
          <div className="postprocess-original">
            <span className="label">ASR 原始</span> <code>{postprocessReport.original}</code>
          </div>
          <div className="postprocess-arrow">↓ postprocess</div>
          <div className="postprocess-processed">
            <span className="label">注入版本</span> <code>{postprocessReport.processed}</code>
          </div>
          <div className="postprocess-rules">
            套用規則：
            {postprocessReport.appliedRules.map((id) => (
              <span key={id} className="rule-chip">{id}</span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="error">⚠️ ASR 錯誤：{error}</p>}
      {micError && <p className="error">⚠️ {micError}</p>}

      {history.length > 0 && (
        <details className="asr-history">
          <summary>歷史辨識結果（{history.length}）</summary>
          <ul>
            {history.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ul>
        </details>
      )}

      <p className="hint">提示：模型未下載時點開始會提示「ASR manager not initialized」。</p>
    </section>
  );
}
