/**
 * Sherpa-onnx streaming ASR engine
 *
 * 用 sherpa-onnx-node 的 OnlineRecognizer 提供低延遲 streaming 辨識。
 * 預設模型：sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
 *
 * 工作流程：
 *   1. init() 載入 OnlineRecognizer（一次性）
 *   2. start() 創建 OnlineStream
 *   3. feed() 推 PCM → acceptWaveform → while isReady decode → getResult
 *   4. isEndpoint 偵測到 → emit partial(isEndpoint=true) → reset stream
 *   5. stop() 跑 final decode → emit final text → dispose stream
 */

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { OnlineRecognizer, type OnlineRecognizerConfig } from 'sherpa-onnx-node';
import type { AsrEngine, AsrConfig, AsrResult, AsrEvents } from './engine';

export declare interface SherpaOnnxEngine {
  on<U extends keyof AsrEvents>(event: U, listener: AsrEvents[U]): this;
  off<U extends keyof AsrEvents>(event: U, listener: AsrEvents[U]): this;
  emit<U extends keyof AsrEvents>(event: U, ...args: Parameters<AsrEvents[U]>): boolean;
}

/** 預設模型子目錄名稱（解 tar.bz2 後的目錄） */
const DEFAULT_MODEL_DIR_NAME = 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20';

export class SherpaOnnxEngine extends EventEmitter implements AsrEngine {
  readonly name = 'sherpa-onnx';

  private recognizer: OnlineRecognizer | null = null;
  private stream: ReturnType<OnlineRecognizer['createStream']> | null = null;
  private segment = 0;
  private isRunning = false;
  private sampleRate = 16000;
  private lastPartialText = '';

  /**
   * 從 sampleRate 抽出 recognizer 設定（sherpa-onnx feat config）
   * 依 modelPreset 動態選檔名：
   * - Luigi ft75m / x-asr 系列：新版檔名（`encoder.int8.onnx` / `decoder.onnx` / `joiner.int8.onnx`）
   * - sherpa-zh-en 經典版：舊版檔名（`encoder-epoch-99-avg-1.int8.onnx` / `decoder-epoch-99-avg-1.onnx` / `joiner-epoch-99-avg-1.int8.onnx`）
   */
  private buildRecognizerConfig(modelDir: string, sampleRate: number): OnlineRecognizerConfig {
    const { encoder, decoder, joiner } = this.resolveModelPaths(modelDir);
    const tokens = join(modelDir, 'tokens.txt');

    return {
      featConfig: {
        sampleRate,
        featureDim: 80,
      },
      modelConfig: {
        transducer: {
          encoder,
          decoder,
          joiner,
        },
        tokens,
        numThreads: 2,
        provider: 'cpu',
        modelType: 'zipformer',
      },
      enableEndpoint: true,
      // 端點偵測規則：sherpa-onnx 預設
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
      decodingMethod: 'greedy_search',
    };
  }

  /**
   * 依檔名慣例解析 encoder/decoder/joiner 路徑
   * P5：Luigi ft75m 與 x-asr 系列用新版檔名；sherpa-zh-en 經典版用舊版檔名
   */
  private resolveModelPaths(modelDir: string): { encoder: string; decoder: string; joiner: string } {
    // 新版檔名（Luigi / x-asr 系列）
    const newEncoder = join(modelDir, 'encoder.onnx');
    const newEncoderInt8 = join(modelDir, 'encoder.int8.onnx');
    const newDecoder = join(modelDir, 'decoder.onnx');
    const newJoiner = join(modelDir, 'joiner.onnx');
    const newJoinerInt8 = join(modelDir, 'joiner.int8.onnx');

    // 舊版檔名（sherpa-zh-en 經典版 v2023）
    const oldEncoder = join(modelDir, 'encoder-epoch-99-avg-1.onnx');
    const oldEncoderInt8 = join(modelDir, 'encoder-epoch-99-avg-1.int8.onnx');
    const oldDecoder = join(modelDir, 'decoder-epoch-99-avg-1.onnx');
    const oldJoiner = join(modelDir, 'joiner-epoch-99-avg-1.onnx');
    const oldJoinerInt8 = join(modelDir, 'joiner-epoch-99-avg-1.int8.onnx');

    // 優先偵測新版檔名（Luigi / x-asr）
    if (existsSync(newEncoderInt8) || existsSync(newEncoder)) {
      return {
        encoder: existsSync(newEncoderInt8) ? newEncoderInt8 : newEncoder,
        decoder: newDecoder,
        joiner: existsSync(newJoinerInt8) ? newJoinerInt8 : newJoiner,
      };
    }
    // fallback 舊版檔名（sherpa-zh-en 經典版）
    return {
      encoder: existsSync(oldEncoderInt8) ? oldEncoderInt8 : oldEncoder,
      decoder: oldDecoder,
      joiner: existsSync(oldJoinerInt8) ? oldJoinerInt8 : oldJoiner,
    };
  }

  /**
   * 解析模型路徑
   * 優先順序：customPath > customModelDir > 預設下載位置
   */
  private resolveModelDir(config: AsrConfig): string {
    if (config.customPath) {
      return config.customPath;
    }
    if (config.modelDir) {
      return config.modelDir;
    }
    // 預設：<userData>/models/<preset-dir>
    // 注意：這裡不能直接用 electron app，要傳入 userData 路徑
    throw new Error(
      'sherpa-onnx: modelDir not specified. ' +
        `請下載 ${DEFAULT_MODEL_DIR_NAME} 並放到 models 目錄，或設定 customPath。`,
    );
  }

  async init(config: AsrConfig): Promise<void> {
    if (this.recognizer) {
      throw new Error('sherpa-onnx: already initialized');
    }
    this.sampleRate = config.sampleRate;

    const modelDir = this.resolveModelDir(config);

    // 檢查必要檔案
    const required = [
      'tokens.txt',
      'encoder-epoch-99-avg-1.onnx',
      'decoder-epoch-99-avg-1.onnx',
      'joiner-epoch-99-avg-1.onnx',
    ];
    for (const f of required) {
      if (!existsSync(join(modelDir, f))) {
        throw new Error(
          `sherpa-onnx: 必要檔案不存在 ${join(modelDir, f)}\n` +
            `請用 npm run download-model sherpa-zh-en 下載模型到 models 目錄。`,
        );
      }
    }

    const recognizerConfig = this.buildRecognizerConfig(modelDir, config.sampleRate);

    try {
      // sherpa-onnx-node 用 `new` 創建 recognizer
      this.recognizer = new OnlineRecognizer(recognizerConfig);
      console.log(`[asr.sherpa-onnx] loaded: ${modelDir}`);
      this.emit('ready');
    } catch (err) {
      throw new Error(
        `sherpa-onnx: failed to create recognizer: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  start(): void {
    if (!this.recognizer) {
      throw new Error('sherpa-onnx: not initialized');
    }
    if (this.isRunning) {
      console.warn('[asr.sherpa-onnx] start() called while already running, ignoring');
      return;
    }

    this.stream = this.recognizer.createStream();
    this.segment = 0;
    this.lastPartialText = '';
    this.isRunning = true;
    console.log('[asr.sherpa-onnx] stream started');
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.isRunning || !this.stream || !this.recognizer) {
      return;
    }
    if (sampleRate !== this.sampleRate) {
      console.warn(
        `[asr.sherpa-onnx] sample rate mismatch: expected ${this.sampleRate}, got ${sampleRate}`,
      );
      return;
    }

    // 推 audio chunk 進 stream
    this.stream.acceptWaveform(sampleRate, samples);

    // decode loop：把所有 ready 的 chunk 都解完
    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream);
    }

    // 取出 partial result
    const result = this.recognizer.getResult(this.stream);
    const text = (result.text ?? '').trim();

    if (text && text !== this.lastPartialText) {
      this.lastPartialText = text;
      this.emit('partial', text, false, this.segment);
    }

    // 端點偵測
    if (this.recognizer.isEndpoint(this.stream)) {
      // emit final partial 給這段
      this.emit('partial', text, true, this.segment);
      this.segment++;
      this.lastPartialText = '';
      // reset stream 準備下一段
      this.recognizer.reset(this.stream);
    }
  }

  async stop(): Promise<AsrResult> {
    if (!this.isRunning || !this.stream || !this.recognizer) {
      return { text: '', segments: 0, durationMs: 0 };
    }

    // flush 最後的 audio（如果有 buffer 中的）
    // sherpa-onnx 的 inputFinished() 告訴 stream 沒有更多 audio
    this.stream.inputFinished();
    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream);
    }
    const finalResult = this.recognizer.getResult(this.stream);
    const finalText = (finalResult.text ?? '').trim();

    if (finalText && finalText !== this.lastPartialText) {
      this.emit('partial', finalText, true, this.segment);
    }

    this.isRunning = false;
    this.stream = null;
    this.segment = 0;
    this.lastPartialText = '';
    console.log(`[asr.sherpa-onnx] stream stopped, final: "${finalText}"`);

    return {
      text: finalText,
      segments: this.segment,
      durationMs: 0, // TODO: 追蹤時間
    };
  }

  dispose(): void {
    if (this.stream) {
      this.stream.free();
      this.stream = null;
    }
    if (this.recognizer) {
      this.recognizer.free();
      this.recognizer = null;
    }
    this.isRunning = false;
    console.log('[asr.sherpa-onnx] disposed');
  }

  get initialized(): boolean {
    return this.recognizer !== null;
  }

  get running(): boolean {
    return this.isRunning;
  }
}
