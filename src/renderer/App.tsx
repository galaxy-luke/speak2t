/**
 * P0 Hello-world 主頁面 + P1 stage 1 mic 擷取測試
 *
 * P0：
 * - 顯示目前設定（從 main 讀取）
 * - 顯示「按 Ctrl+Shift+Space 測試」說明
 * - 監聽熱鍵觸發事件，顯示「收到熱鍵」toast
 *
 * P1 stage 1：
 * - 「開始/停止錄音」按鈕，連接 getUserMedia + AudioWorklet
 * - 顯示 audio chunk 計數 + 即時音量條
 * - 驗證 IPC 從 renderer → main 通
 * - 階段 4 會把按鈕邏輯搬到熱鍵 toggle
 */

import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../shared/types';
import type { StatusEventPayload } from '../shared/api';

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<StatusEventPayload['status']>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [hotkeyCount, setHotkeyCount] = useState(0);

  // P1 stage 1: mic 狀態
  const [isRecording, setIsRecording] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  // 音訊相關 ref（不觸發 re-render）
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // 初始化：讀設定、訂閱事件
  useEffect(() => {
    window.speak2t.getSettings().then(setSettings);

    const offHotkey = window.speak2t.onHotkeyTriggered(() => {
      setHotkeyCount((c) => c + 1);
      setToast('🎙️ 收到熱鍵！');
      setTimeout(() => setToast(null), 2000);
    });

    const offStatus = window.speak2t.onStatusChanged((data) => {
      setStatus(data.status);
    });

    const offLevel = window.speak2t.onIndicatorLevel((data) => {
      setLevel(data.level);
    });

    return () => {
      offHotkey();
      offStatus();
      offLevel();
    };
  }, []);

  // 元件 unmount 時清理
  useEffect(() => {
    return () => {
      stopMicInternal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startMic() {
    if (isRecording) return;
    setMicError(null);

    try {
      // 1. 抓麥克風
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 2. AudioContext @ 16kHz（sherpa-onnx 期待）
      const sampleRate = 16000;
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      // 3. 載入 AudioWorklet
      await audioContext.audioWorklet.addModule('/audio-worklet.js');

      // 4. 建立 source + worklet node
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(audioContext, 'audio-capture-processor');
      workletNodeRef.current = worklet;

      // 5. 連接：source → worklet
      // 注意：不要 connect 到 destination（會聽到自己的聲音）
      source.connect(worklet);

      // 6. 接收 worklet 推過來的 chunks → IPC 給 main
      worklet.port.onmessage = (event) => {
        const { samples } = event.data as { samples: Float32Array };
        // 拷一份給 IPC（worklet postMessage 之後 buffer 會被清空）
        const copy = new Float32Array(samples);
        window.speak2t.sendAudioChunk(copy, sampleRate);
        setChunkCount((c) => c + 1);
      };

      setIsRecording(true);
      setChunkCount(0);
      console.log('[renderer] mic started');
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
    setIsRecording(false);
    setLevel(0);
    console.log('[renderer] mic stopped');
  }

  return (
    <div className="container">
      <h1>🎙️ Speak2T</h1>
      <p className="subtitle">台灣繁體中文語音輸入工具 · P0 雛形 + P1 stage 1 mic 測試</p>

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
          </dl>
        ) : (
          <p>載入中…</p>
        )}
      </section>

      <section className="card">
        <h2>P0 驗證</h2>
        <p>請按全域熱鍵測試：</p>
        <div className="hotkey-test">
          <kbd>{settings?.hotkey ?? '...'}</kbd>
          <span className="count">觸發次數：{hotkeyCount}</span>
        </div>
      </section>

      <section className="card">
        <h2>P1 Stage 1 — Mic 擷取測試</h2>
        <p>點按鈕啟動麥克風，講話後看 main 端是否收到 audio chunks：</p>
        <div className="mic-test">
          {isRecording ? (
            <button className="btn btn-stop" onClick={stopMic}>
              ⏹ 停止錄音
            </button>
          ) : (
            <button className="btn btn-start" onClick={startMic}>
              🎙️ 開始錄音
            </button>
          )}
          <span className="count">IPC chunks: {chunkCount}</span>
        </div>

        {/* 音量條 */}
        <div className="level-bar">
          <div className="level-fill" style={{ width: `${Math.min(level * 100, 100)}%` }} />
        </div>

        {micError && <p className="error">⚠️ {micError}</p>}

        <p className="hint">
          啟用後請允許麥克風權限。設定環境變數 <code>SPEAK2T_DEBUG_WAV=1</code> 可在 userData/debug 寫 wav 檔。
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
