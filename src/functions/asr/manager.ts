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
import type { AppSettings, AsrEngineType } from '../../shared/types';
import type { AsrEngine, AsrConfig, AsrResult } from './engine';
import { SherpaOnnxEngine } from './sherpa-onnx';
import { WhisperCppEngine } from './whisper-cpp';
import { postprocessWithReport } from '../postprocess';
import { DEFAULT_RULES } from '../postprocess';
import type { AsrPostprocessedPayload, AsrEngineDegradedPayload } from '../../shared/api';

export interface AsrManagerEvents {
  ready: () => void;
  error: (err: Error) => void;
  text: (text: string) => void; // 整段錄音結束時的最終文字
  /**
   * P3：後處理結果（給 debug UI 用）
   * 即使未啟用後處理也會 emit（此時 appliedRules=[]、changed=false）
   */
  postprocessed: (report: AsrPostprocessedPayload) => void;
  /**
   * P3：引擎降級（sherpa 失敗 → 自動切 whisper）
   */
  degraded: (report: AsrEngineDegradedPayload) => void;
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

  // ===== P3 Stage 2：引擎降級狀態 =====
  /** runtime 當前 engine（可能與 settings.asrEngine 不同，因降級） */
  private currentEngine: AsrEngineType;
  /** 降級用計數器（連續 feed 失敗達標就觸發） */
  private consecutiveFeedFailures = 0;
  /** 是否已降級過（避免重複降級） */
  private hasDegraded = false;
  /** 降級連續失敗 threshold */
  private static readonly DEGRADE_THRESHOLD = 2;

  constructor(settings: AppSettings) {
    super();
    this.settings = settings;
    this.currentEngine = settings.asrEngine;
  }

  /**
   * 取得 runtime 當前 engine（可能與 settings.asrEngine 不同）
   */
  get runtimeEngine(): AsrEngineType {
    return this.currentEngine;
  }

  /**
   * 初始化當前設定的引擎
   * 必須先 init 才能 start/feed
   *
   * P3 Stage 2：若 settings.autoDegrade 開，初始化失敗時自動切到備援引擎
   */
  async init(): Promise<void> {
    if (this.engine) {
      console.warn('[asr.manager] already initialized, disposing first');
      this.engine.dispose();
      this.engine = null;
    }

    // 重置降級狀態（user 重新 init 通常是想從頭來）
    this.consecutiveFeedFailures = 0;

    const modelDir = this.resolveModelDir();
    const config: AsrConfig = {
      engine: this.currentEngine,
      modelPreset: this.settings.asrModelPreset,
      customPath: this.settings.customModelPath || undefined,
      modelDir,
      sampleRate: this.settings.audioSampleRate,
    };

    if (this.currentEngine === 'sherpa-onnx') {
      this.engine = new SherpaOnnxEngine();
    } else if (this.currentEngine === 'whisper-cpp') {
      this.engine = new WhisperCppEngine();
    } else {
      throw new Error(`ASR engine "${this.currentEngine}" 尚未支援`);
    }

    // wire engine 事件 → IPC 廣播
    this.engine.on('partial', (text, isEndpoint, segment) => {
      console.log(`[asr.manager] partial: "${text}" endpoint=${isEndpoint} seg=${segment}`);

      // 成功收到 partial → 重置失敗計數
      this.consecutiveFeedFailures = 0;

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
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[asr.manager] ${this.currentEngine} init 失敗：${errorMsg}`);

      // 清掉 engine reference
      this.engine.dispose();
      this.engine = null;

      // P3 Stage 2：嘗試自動降級
      if (this.settings.autoDegrade && !this.hasDegraded) {
        const fallback = this.currentEngine === 'sherpa-onnx' ? 'whisper-cpp' : 'sherpa-onnx';
        console.log(`[asr.manager] 自動降級：${this.currentEngine} → ${fallback}`);
        this.degradeTo(fallback, `init 失敗：${errorMsg}`);
        // 遞迴重試（這次會用新 engine）
        return this.init();
      }

      // 無降級可用或已降級過
      throw err;
    }
  }

  /**
   * P3 Stage 2：降級到指定 engine（runtime 切換，不改 settings.asrEngine）
   * 廣播 ASR_ENGINE_DEGRADED 給 UI 顯示提示
   */
  private degradeTo(target: AsrEngineType, reason: string): void {
    const from = this.currentEngine;
    this.currentEngine = target;
    this.hasDegraded = true;

    const payload: AsrEngineDegradedPayload = {
      from,
      to: target,
      reason,
      timestamp: Date.now(),
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ASR_ENGINE_DEGRADED, payload);
      }
    }
    this.emit('degraded', payload);
    console.log(`[asr.manager] 降級完成：${from} → ${target}（${reason}）`);
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
   *
   * P3 Stage 2：連續 feed 失敗計數，達標觸發降級
   */
  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.engine) return;
    try {
      this.engine.feed(samples, sampleRate);
      // 成功 → 失敗計數已在 partial event listener 重置（這裡再保險一次）
      this.consecutiveFeedFailures = 0;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[asr.manager] feed error:', errorMsg);
      this.consecutiveFeedFailures++;
      this.emit('error', err instanceof Error ? err : new Error(errorMsg));

      // P3 Stage 2：達標觸發降級
      if (
        this.settings.autoDegrade &&
        !this.hasDegraded &&
        this.consecutiveFeedFailures >= AsrManager.DEGRADE_THRESHOLD
      ) {
        const fallback =
          this.currentEngine === 'sherpa-onnx' ? 'whisper-cpp' : 'sherpa-onnx';
        console.warn(
          `[asr.manager] 連續 ${this.consecutiveFeedFailures} 次 feed 失敗，自動降級：${this.currentEngine} → ${fallback}`,
        );
        this.degradeTo(fallback, `連續 feed 失敗 ${this.consecutiveFeedFailures} 次`);
        // 下一輪錄音會用 fallback engine（不立即 re-init，避免中斷正在跑的 session）
      }
    }
  }

  /**
   * 停止 ASR 串流，廣播最終結果
   *
   * P3：套用後處理器（標點修正）並廣播詳細結果
   */
  async stop(): Promise<AsrResult> {
    if (!this.engine) {
      return { text: '', segments: 0, durationMs: 0 };
    }
    const result = await this.engine.stop();
    this.totalDurationMs = Date.now() - this.startTime;

    // 合併所有 segment 成最終文字
    const rawText = this.segmentBuffer.join(' ').trim() || result.text;
    this.segmentBuffer = [];

    // P3 Stage 1：套用後處理器
    const report = postprocessWithReport(
      rawText,
      this.settings.postprocessEnabled ? undefined : { disabledRules: DEFAULT_RULES.map((r) => r.id) },
    );
    const finalText = report.processed;
    const changed = report.original !== report.processed;
    this.lastFinalText = finalText;

    // 廣播後處理結果（給 debug UI）
    const postprocessedPayload: AsrPostprocessedPayload = {
      original: report.original,
      processed: report.processed,
      appliedRules: report.appliedRules,
      skippedRules: report.skippedRules,
      changed,
      timestamp: Date.now(),
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.ASR_POSTPROCESSED, postprocessedPayload);
      }
    }
    this.emit('postprocessed', postprocessedPayload);

    const finalResult: AsrResult = {
      text: finalText,
      segments: result.segments,
      durationMs: this.totalDurationMs,
    };

    // broadcast final（已後處理過的文字）
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
   *
   * P3 Stage 2：user 手動切回時重置 hasDegraded 旗標（讓再次降級可用）
   */
  async switchEngine(newSettings: AppSettings): Promise<void> {
    this.settings = newSettings;
    this.currentEngine = newSettings.asrEngine;
    this.hasDegraded = false; // user 明確切換，重置降級狀態
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
