/**
 * ASR Manager
 *
 * 包裝 AsrEngine，提供：
 * - 引擎生命週期管理（init / dispose）
 * - 引擎切換（sherpa-onnx ↔ whisper.cpp，根據 settings）
 * - 把 engine 事件轉成 IPC 廣播給所有 renderer
 *
 * 設計：一次只持有一個 engine 實例（避免吃滿 CPU）
 */

import { EventEmitter } from 'node:events';
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc-channels';
import type { AppSettings } from '../../shared/types';
import type { AsrEngine, AsrConfig, AsrResult } from './engine';
import { SherpaOnnxEngine } from './sherpa-onnx';

export interface AsrManagerEvents {
  ready: () => void;
  error: (err: Error) => void;
  text: (text: string) => void; // 整段錄音結束時的最終文字
}

export declare interface AsrManager {
  on<U extends keyof AsrManagerEvents>(event: U, listener: AsrManagerEvents[U]): this;
  emit<U extends keyof AsrManagerEvents>(event: U, ...args: Parameters<AsrManagerEvents[U]>): boolean;
}

export class AsrManager extends EventEmitter {
  private engine: AsrEngine | null = null;
  private settings: AppSettings;
  private segmentBuffer: string[] = [];
  private startTime = 0;
  private totalDurationMs = 0;
  private lastFinalText = '';

  constructor(settings: AppSettings) {
    super();
    this.settings = settings;
  }

  /**
   * 初始化當前設定的引擎（依 settings.asrEngine 決定 sherpa / whisper）
   * 必須先 init 才能 start/feed
   */
  async init(): Promise<void> {
    if (this.engine) {
      console.warn('[asr.manager] already initialized, disposing first');
      this.engine.dispose();
      this.engine = null;
    }

    const modelDir = this.resolveModelDir();

    const config: AsrConfig = {
      engine: this.settings.asrEngine,
      modelPreset: this.settings.asrModelPreset,
      customPath: this.settings.customModelPath || undefined,
      modelDir,
      sampleRate: this.settings.audioSampleRate,
    };

    if (this.settings.asrEngine === 'sherpa-onnx') {
      this.engine = new SherpaOnnxEngine();
    } else {
      // whisper.cpp 留 stage 5
      throw new Error(
        `ASR engine "${this.settings.asrEngine}" 尚未實作（P1 stage 5 才做）`,
      );
    }

    // wire engine 事件 → IPC 廣播
    this.engine.on('partial', (text, isEndpoint, segment) => {
      console.log(`[asr.manager] partial: "${text}" endpoint=${isEndpoint} seg=${segment}`);

      // broadcast 到所有 renderer
      const payload = { text, isEndpoint, segment, timestamp: Date.now() };
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.ASR_PARTIAL, payload);
          // 同步廣播 indicator 文字（給 frameless 浮窗用）
          win.webContents.send(IPC.INDICATOR_TEXT, { text, timestamp: Date.now() });
        }
      }

      if (isEndpoint && text) {
        this.segmentBuffer.push(text);
      }
    });

    this.engine.on('error', (err) => {
      console.error('[asr.manager] engine error:', err);
      this.emit('error', err);

      const payload = { code: 'asr_error', message: err.message, timestamp: Date.now() };
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.ASR_ERROR, payload);
        }
      }
    });

    this.engine.on('ready', () => {
      console.log('[asr.manager] engine ready');
      this.emit('ready');
    });

    // 實際初始化引擎（可能拋錯：模型檔不存在）
    try {
      await this.engine.init(config);
    } catch (err) {
      // 清掉 engine reference
      this.engine.dispose();
      this.engine = null;
      throw err;
    }
  }

  /**
   * 解析模型根目錄
   * 路徑：<userData>/models/<preset-dir>
   */
  private resolveModelDir(): string {
    const preset = this.settings.asrModelPreset;
    const dirName = preset; // 目前 preset 名稱直接對應模型目錄名
    return join(app.getPath('userData'), 'models', dirName);
  }

  /**
   * 開始新一輪 ASR 串流
   */
  start(): void {
    if (!this.engine) {
      throw new Error('asr.manager: not initialized');
    }
    this.segmentBuffer = [];
    this.startTime = Date.now();
    this.totalDurationMs = 0;
    this.lastFinalText = '';
    this.engine.start();
  }

  /**
   * 餵入 audio chunk（給 audio.ingest 'chunk' event listener 用）
   */
  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.engine) return;
    try {
      this.engine.feed(samples, sampleRate);
    } catch (err) {
      console.error('[asr.manager] feed error:', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * 停止 ASR 串流，廣播最終結果
   */
  async stop(): Promise<AsrResult> {
    if (!this.engine) {
      return { text: '', segments: 0, durationMs: 0 };
    }
    const result = await this.engine.stop();
    this.totalDurationMs = Date.now() - this.startTime;

    // 合併所有 segment 成最終文字
    const finalText = this.segmentBuffer.join(' ').trim();
    this.lastFinalText = finalText;
    this.segmentBuffer = [];

    const finalResult: AsrResult = {
      text: finalText || result.text,
      segments: result.segments,
      durationMs: this.totalDurationMs,
    };

    // broadcast final
    const payload = {
      text: finalResult.text,
      segment: finalResult.segments,
      durationMs: finalResult.durationMs,
      timestamp: Date.now(),
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ASR_FINAL, payload);
      }
    }

    this.emit('text', finalResult.text);
    return finalResult;
  }

  /**
   * 切換引擎（settings 變更時呼叫）
   * 會 dispose 舊 engine、init 新 engine
   */
  async switchEngine(newSettings: AppSettings): Promise<void> {
    this.settings = newSettings;
    await this.init();
  }

  /**
   * 釋放所有資源
   */
  dispose(): void {
    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }
  }

  get initialized(): boolean {
    return this.engine !== null;
  }

  get lastText(): string {
    return this.lastFinalText;
  }
}
