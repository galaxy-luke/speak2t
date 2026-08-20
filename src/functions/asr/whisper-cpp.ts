/**
 * Whisper.cpp ASR engine（offline 模式）
 *
 * 用 @kutalia/whisper-node-addon 把整段 audio 一次送 whisper.cpp 轉錄。
 * 沒有 streaming partial（要等 stop() 才出結果）。
 *
 * 工作流程：
 *   1. init() 載入 ggml 模型（不實際 load binary，transcribe 時才 load）
 *   2. start() 重置 audio buffer
 *   3. feed() 累積 PCM Float32 到 buffer
 *   4. stop() 把 buffer 寫成 tmp wav → whisper.transcribe() → 解析結果 → emit partial(final)
 *
 * 限制：
 * - 整段 audio 一次處理，延遲較高（看長度，可能 1-3s+）
 * - 不支援 streaming partial（要 emit 一次性的 final partial）
 * - 整段 audio 緩衝在記憶體，長錄音（>5 分鐘）會吃記憶體
 *
 * 預設模型：ggml-small.bin（中文+英文，~460 MB）
 */

import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import whisperAddon from '@kutalia/whisper-node-addon';
import type { AsrEngine, AsrConfig, AsrResult, AsrEvents } from './engine';

export declare interface WhisperCppEngine {
  on<U extends keyof AsrEvents>(event: U, listener: AsrEvents[U]): this;
  off<U extends keyof AsrEvents>(event: U, listener: AsrEvents[U]): this;
  emit<U extends keyof AsrEvents>(event: U, ...args: Parameters<AsrEvents[U]>): boolean;
}

/** 預設模型檔名（ggml-small 支援中英） */
const DEFAULT_MODEL_NAME = 'ggml-small.bin';

export class WhisperCppEngine extends EventEmitter implements AsrEngine {
  readonly name = 'whisper-cpp';

  private modelPath: string | null = null;
  private audioBuffer: Float32Array[] = [];
  private totalSamples = 0;
  private sampleRate = 16000;
  private isRunning = false;
  private language: 'zh' | 'en' | 'auto' = 'auto';

  /**
   * 解析模型路徑
   */
  private resolveModelPath(config: AsrConfig): string {
    if (config.customPath) {
      // customPath 可能是模型檔案本身，或模型目錄
      if (existsSync(config.customPath) && config.customPath.endsWith('.bin')) {
        return config.customPath;
      }
      return join(config.customPath, DEFAULT_MODEL_NAME);
    }
    if (config.modelDir) {
      return join(config.modelDir, DEFAULT_MODEL_NAME);
    }
    throw new Error(
      'whisper-cpp: modelDir not specified. ' +
        `請下載 ${DEFAULT_MODEL_NAME} 並放到 models 目錄，或設定 customPath。`,
    );
  }

  async init(config: AsrConfig): Promise<void> {
    this.sampleRate = config.sampleRate;
    this.modelPath = this.resolveModelPath(config);

    if (!existsSync(this.modelPath)) {
      throw new Error(
        `whisper-cpp: 模型檔不存在 ${this.modelPath}\n` +
          `請用 npm run download-model whisper-small 下載模型到 models 目錄。`,
      );
    }

    console.log(`[asr.whisper-cpp] ready: ${this.modelPath}`);
    this.emit('ready');
  }

  start(): void {
    if (this.isRunning) {
      console.warn('[asr.whisper-cpp] start() called while already running, ignoring');
      return;
    }
    this.audioBuffer = [];
    this.totalSamples = 0;
    this.isRunning = true;
    console.log('[asr.whisper-cpp] stream started (offline mode)');
  }

  feed(samples: Float32Array, _sampleRate: number): void {
    if (!this.isRunning) {
      return;
    }
    // offline 模式：只累積 buffer，不即時處理
    this.audioBuffer.push(samples);
    this.totalSamples += samples.length;
  }

  async stop(): Promise<AsrResult> {
    if (!this.isRunning) {
      return { text: '', segments: 0, durationMs: 0 };
    }
    this.isRunning = false;

    if (this.totalSamples === 0 || this.audioBuffer.length === 0) {
      console.log('[asr.whisper-cpp] no audio captured');
      return { text: '', segments: 0, durationMs: 0 };
    }

    const startTime = Date.now();

    // 1. 合併 audio buffer
    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const buf of this.audioBuffer) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    this.audioBuffer = [];
    this.totalSamples = 0;

    // 2. 寫 tmp wav 檔
    const tmpDir = join(app.getPath('userData'), 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const tmpWav = join(tmpDir, `whisper-${Date.now()}.wav`);
    this.writeWav(tmpWav, merged, this.sampleRate);

    try {
      // 3. whisper transcribe
      console.log(`[asr.whisper-cpp] transcribing ${merged.length} samples (${(merged.length / this.sampleRate).toFixed(1)}s)...`);

      const result = await whisperAddon.transcribe({
        fname_inp: tmpWav,
        model: this.modelPath!,
        language: this.language,
        use_gpu: true,
        no_prints: true,
      });

      const text = (result.text ?? '').trim();
      const durationMs = Date.now() - startTime;

      console.log(`[asr.whisper-cpp] result: "${text}" (${durationMs}ms)`);

      // emit 一次性的 final partial（給 UI / indicator 顯示）
      if (text) {
        this.emit('partial', text, true, 0);
      }

      return {
        text,
        segments: result.segments?.length ?? 1,
        durationMs,
      };
    } catch (err) {
      throw new Error(
        `whisper-cpp transcribe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // 4. 清理 tmp wav
      try {
        unlinkSync(tmpWav);
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    this.audioBuffer = [];
    this.totalSamples = 0;
    this.isRunning = false;
    this.modelPath = null;
    console.log('[asr.whisper-cpp] disposed');
  }

  /**
   * 寫 PCM Float32 → 16-bit WAV 檔
   */
  private writeWav(path: string, samples: Float32Array, sampleRate: number): void {
    // Float32 → Int16
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      pcm[i] = Math.round(clamped * 32767);
    }

    // WAV header (44 bytes, PCM format)
    const dataLength = pcm.length * 2;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    writeFileSync(path, Buffer.concat([header, Buffer.from(pcm.buffer)]));
  }

  get initialized(): boolean {
    return this.modelPath !== null;
  }

  get running(): boolean {
    return this.isRunning;
  }
}
