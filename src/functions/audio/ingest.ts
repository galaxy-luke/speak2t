/**
 * Audio ingest module
 *
 * 接收來自 renderer 的 audio chunks，累積成完整錄音。
 *
 * P1 階段 1：只做 buffer 累積 + debug wav 寫檔 + level 計算。
 * P1 階段 2：接入 ASR engine，把 audio 餵給 sherpa-onnx streaming recognizer。
 *
 * 設計：EventEmitter pattern，方便 stage 2 接入 asr.feed() listener。
 */

import { EventEmitter } from 'node:events';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

export interface AudioIngestEvents {
  /** 音量條 level（peak amplitude 0.0 ~ 1.0） */
  level: (level: number) => void;
  /** 給 ASR engine：每 100ms chunk */
  chunk: (samples: Float32Array, sampleRate: number) => void;
}

export declare interface AudioIngest {
  on<U extends keyof AudioIngestEvents>(event: U, listener: AudioIngestEvents[U]): this;
  emit<U extends keyof AudioIngestEvents>(event: U, ...args: Parameters<AudioIngestEvents[U]>): boolean;
}

export class AudioIngest extends EventEmitter {
  private buffer: Float32Array[] = [];
  private sampleRate = 16000;
  private totalSamples = 0;
  private isRecording = false;
  private debugWavePath: string | null = null;

  /**
   * 開始新一輪錄音。清空 buffer、設定 debug wav 路徑。
   */
  start(): void {
    this.buffer = [];
    this.totalSamples = 0;
    this.isRecording = true;

    // 設環境變數才寫 debug wav（避免無謂 IO）
    if (process.env.SPEAK2T_DEBUG_WAV === '1') {
      const dir = join(app.getPath('userData'), 'debug');
      mkdirSync(dir, { recursive: true });
      this.debugWavePath = join(dir, `recording-${Date.now()}.wav`);
    } else {
      this.debugWavePath = null;
    }

    console.log('[audio.ingest] started recording');
  }

  /**
   * 停止錄音，回傳錄音統計。
   * 若有設定 debug wav，會寫 wav 檔。
   */
  stop(): { durationMs: number; sampleCount: number } | null {
    if (!this.isRecording) {
      return null;
    }
    this.isRecording = false;

    const sampleCount = this.totalSamples;
    const durationMs = (sampleCount / this.sampleRate) * 1000;

    if (this.debugWavePath && this.buffer.length > 0) {
      try {
        this.writeWav(this.debugWavePath);
        console.log(`[audio.ingest] debug wav written: ${this.debugWavePath} (${durationMs.toFixed(0)}ms)`);
      } catch (err) {
        console.error('[audio.ingest] failed to write wav:', err);
      }
    }

    console.log(`[audio.ingest] stopped recording: ${sampleCount} samples, ${durationMs.toFixed(0)}ms`);

    return { durationMs, sampleCount };
  }

  /**
   * 接收 IPC 推過來的 audio chunk
   * @param samples Float32Array 16kHz mono，-1.0 ~ 1.0
   * @param sampleRate 取樣率（預期 16000）
   */
  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.isRecording) {
      return;
    }

    this.sampleRate = sampleRate;
    this.buffer.push(samples);
    this.totalSamples += samples.length;

    // 計算 peak amplitude（給指示器音量條）
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    this.emit('level', peak);

    // 給 ASR engine（stage 2 會接）
    this.emit('chunk', samples, sampleRate);
  }

  /**
   * 寫 PCM Float32 → 16-bit WAV 檔
   */
  private writeWav(path: string): void {
    // 合併所有 chunks
    const totalLength = this.buffer.reduce((sum, buf) => sum + buf.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const buf of this.buffer) {
      merged.set(buf, offset);
      offset += buf.length;
    }

    // Float32 → Int16
    const pcm = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const clamped = Math.max(-1, Math.min(1, merged[i]));
      pcm[i] = Math.round(clamped * 32767);
    }

    // WAV header (44 bytes, PCM format)
    const dataLength = pcm.length * 2;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // audio format: PCM
    header.writeUInt16LE(1, 22); // channels: mono
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(this.sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    writeFileSync(path, Buffer.concat([header, Buffer.from(pcm.buffer)]));
  }

  get recording(): boolean {
    return this.isRecording;
  }
}

/** Singleton instance */
export const audioIngest = new AudioIngest();
