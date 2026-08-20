/**
 * ModelDownloader（P2 Stage 2）
 *
 * 包裝 scripts/download-model.mjs 為 child process，解析 JSON 事件流，
 * 透過 EventEmitter 對外廣播下載進度。
 *
 * 設計：
 * - Singleton（一次只允許一個下載，避免吃滿資源）
 * - 透過 `process.execPath` + `scripts/download-model.mjs` 啟動（path 安全）
 * - 取消：發 SIGTERM 給 child process，給 3 秒 grace，否則 SIGKILL
 * - TOFU：下載完成時若 preset 沒官方 baseline，自動算整體目錄 hash 存進 settings
 *
 * Hash 語義（**重要**）：
 * - `MODELS[preset].sha256` 與 `verifier.hashModelPath()` 演算法一致
 * - 算法：對模型**整個目錄**的所有檔案（依檔名排序）各算 SHA-256，
 *         再 concat（用 '\n' 分隔）整個串再 SHA-256 一次
 * - 為什麼用整體目錄 hash 而非 tar.bz2 整檔：CLI 解壓完直接算 + app 啟動時校驗都用同一個演算法，
 *   不會有「CLI 算 A、app 算 B 永遠 mismatch」的問題
 */

import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { appState } from '../../main/app-state';
import { establishTofu, type VerificationResult } from './verifier';
import { resolveModelPath, extractCustomRoot } from './paths';
import type { TofuBaseline } from '../../shared/types';

/** 模型基本資訊（UI 顯示用） */
export interface ModelInfo {
  key: string;
  name: string;
  description: string;
  preset: string;
  sizeBytes: number;
  path: string;
  installed: boolean;
  /**
   * 預期 SHA-256（hex lowercase），下載完會校對。
   * 沒填 = 該模型還沒建立 baseline（首次下載後回填）
   */
  sha256: string | null;
}

/** 下載進度事件 */
export interface DownloadProgressEvent {
  preset: string;
  phase: 'downloading' | 'extracting' | 'cleanup' | 'done';
  downloaded: number;
  total: number;
  percent: number;
  speedBps: number;
  remainingSec: number;
  message?: string;
}

/** 完成事件 */
export interface DownloadCompleteEvent {
  preset: string;
  path: string;
  durationMs: number;
}

/** 錯誤事件 */
export interface DownloadErrorEvent {
  preset: string;
  code: string;
  message: string;
}

/** 已存在事件（code = 'exists'） */
export interface DownloadExistsEvent {
  preset: string;
  path: string;
}

/** 取消事件 */
export interface DownloadCancelledEvent {
  preset: string;
}

/** SHA-256 校驗事件 */
export interface DownloadVerifiedEvent {
  preset: string;
  algorithm: 'sha256';
  /** 實際算出的 hash（hex lowercase） */
  actual: string;
  /** 預期 hash（MODELS.sha256，若無則 null = 跳過比對） */
  expected: string | null;
  /** true = 跳過比對（沒 baseline），false = 比對通過 */
  skipped: boolean;
}

/** TOFU 自我校驗基線已建立事件（commit 3 新增） */
export interface TofuEstablishedEvent {
  preset: string;
  /** 新建的 TOFU baseline */
  baseline: TofuBaseline;
  timestamp: number;
}

/** TOFU 自我校驗基線已移除事件（給 UI 同步用） */
export interface TofuRemovedEvent {
  preset: string;
  timestamp: number;
}

/** 校驗結果事件（給 UI 顯示 5 態標籤用） */
export interface VerificationResultEvent {
  preset: string;
  result: VerificationResult;
  timestamp: number;
}

export interface ModelDownloaderEvents {
  start: (e: { preset: string; total: number }) => void;
  progress: (e: DownloadProgressEvent) => void;
  verified: (e: DownloadVerifiedEvent) => void;
  complete: (e: DownloadCompleteEvent) => void;
  error: (e: DownloadErrorEvent) => void;
  exists: (e: DownloadExistsEvent) => void;
  cancelled: (e: DownloadCancelledEvent) => void;
  log: (e: { preset: string; message: string }) => void;
  /** TOFU baseline 已建立 */
  tofuEstablished: (e: TofuEstablishedEvent) => void;
  /** TOFU baseline 已移除 */
  tofuRemoved: (e: TofuRemovedEvent) => void;
  /** 校驗結果（給 UI 顯示 5 態標籤用） */
  verificationResult: (e: VerificationResultEvent) => void;
}

export declare interface ModelDownloader {
  on<U extends keyof ModelDownloaderEvents>(event: U, listener: ModelDownloaderEvents[U]): this;
  emit<U extends keyof ModelDownloaderEvents>(event: U, ...args: Parameters<ModelDownloaderEvents[U]>): boolean;
}

/**
 * 內建模型清單（與 scripts/download-model.mjs MODELS 同步）
 * 兩邊都改才不會 drift，comment 有提示
 *
 * P5 新增：luigi-x-asr-zh-tw-en-ft75m（Luigi 繁中精調，2026-06，HF git LFS 多檔案）
 *          sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05（x-asr 簡中 480ms）
 * 保留：sherpa-zh-en 經典版 v2023、whisper-small
 */
const MODELS: Omit<ModelInfo, 'installed' | 'path'>[] = [
  {
    key: 'luigi-x-asr-zh-tw-en-ft75m',
    name: 'x-asr 繁中 (Luigi 75M)',
    description: 'Luigi 微調 75M 串流（台灣國語 1560h 精調，~132 MB，自動加標點）',
    preset: 'luigi-x-asr-zh-tw-en-ft75m',
    sizeBytes: 138_200_625,
    /**
     * 整體目錄 hash（4 個檔 concat 再 hash 一次）
     * 用 `node scripts/download-model.mjs --print-hash luigi-x-asr-zh-tw-en-ft75m` 計算並回填
     * 2026-08-20 算：4 個檔
     */
    sha256: '40e563f8d7acc4bc22dfd8483e65ba40d68f4f9fc6c424a95d37f87cac86060f',
  },
  {
    key: 'x-asr-480ms-punct',
    name: 'x-asr 簡中 480ms',
    description: 'sherpa-onnx 官方 x-asr 簡中 480ms（int8，~128 MB，自動加標點）',
    preset: 'sherpa-onnx-x-asr-480ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05',
    sizeBytes: 133_895_136,
    /**
     * 整體目錄 hash（解壓後目錄所有檔 concat 再 hash 一次）
     * TODO: 首次下載後用 `node scripts/download-model.mjs --print-hash x-asr-480ms-punct` 算回填
     * 沒填 = 該模型還沒建立 baseline（首次下載後會自動建 TOFU 存進 settings）
     */
    sha256: null, // TODO: 首次下載後回填
  },
  {
    key: 'sherpa-zh-en',
    name: 'sherpa 經典版 (v2023)',
    description: 'sherpa-onnx 串流模型（中英混講，~340 MB，無標點）',
    preset: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    sizeBytes: 357_564_000,
    /**
     * 整體目錄 hash（解壓後目錄所有檔 concat 再 hash 一次）
     * 變更歷史：原本是 tar.bz2 整檔 hash，2026-08-20 改為整體目錄 hash 與 verifier 演算法一致
     * 2026-08-20 算：10 個檔
     */
    sha256: '58560cb167aaa25b4aa06001f581be4fabb35cab12f3f26369b080f725f9620c',
  },
  {
    key: 'whisper-small',
    name: 'whisper-small (ggml)',
    description: 'Whisper.cpp 離線模型（中英，~460 MB）',
    preset: 'whisper-small',
    sizeBytes: 462_422_000,
    /**
     * 整體 hash（單一檔案，hashModelPath 對單檔直接算 SHA-256）
     * TODO: 首次下載後用 `node scripts/download-model.mjs --print-hash whisper-small` 算回填
     * 沒填 = 該模型還沒建立 baseline（首次下載後會自動建 TOFU 存進 settings）
     */
    sha256: null, // TODO: 首次下載後回填
  },
];

export class ModelDownloader extends EventEmitter {
  private currentChild: ChildProcess | null = null;
  private currentPreset: string | null = null;
  private cancelTimer: NodeJS.Timeout | null = null;

  /**
   * 列出所有可用模型（含本機是否已安裝）
   *
   * 路徑優先序（commit: customModelPath 完整接通）：
   * 1. settings.customModelPath（自訂下載根目錄）→ join(customRoot, preset)
   * 2. userData/models/<preset>（預設）
   */
  listModels(): ModelInfo[] {
    const customRoot = this.getCustomRootDir();
    const defaultRoot = join(app.getPath('userData'), 'models');
    return MODELS.map((m) => {
      const path = resolveModelPath(customRoot, defaultRoot, m.preset);
      const installed = existsSync(path) && statSync(path).isDirectory();
      return { ...m, path, installed };
    });
  }

  /**
   * 取得自訂下載根目錄（從 settings.customModelPath 讀，trim + empty → undefined）
   * 注意：這是「根目錄」，不是「單一模型路徑」。每個 preset 會裝在 `<root>/<preset>` 子目錄
   */
  private getCustomRootDir(): string | undefined {
    return extractCustomRoot(appState.getSettings().customModelPath);
  }

  /**
   * 啟動下載（async non-blocking，傳回立即）
   * 已在下載中會丟錯
   */
  startDownload(presetKey: string): void {
    if (this.currentChild) {
      throw new Error(`已有下載正在進行中：${this.currentPreset}`);
    }
    const modelInfo = this.listModels().find((m) => m.key === presetKey);
    if (!modelInfo) {
      throw new Error(`未知模型 key：${presetKey}`);
    }

    this.currentPreset = presetKey;

    // 計算 script 路徑（dev 模式從 process.cwd() 找，packaged 模式從 resources）
    const scriptPath = this.resolveScriptPath();
    if (!existsSync(scriptPath)) {
      this.currentPreset = null;
      throw new Error(`download-model.mjs 找不到：${scriptPath}`);
    }

    const child = spawn(
      process.execPath, // 用 Electron 內建的 Node（packaged 也能跑）
      [scriptPath, '--json', presetKey],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1', // 讓 Electron 當純 Node 跑
          // 自訂下載根目錄（commit: customModelPath 完整接通）— CLI 會讀這個 env
          ...(this.getCustomRootDir()
            ? { OUT_DIR: this.getCustomRootDir() as string }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.currentChild = child;
    this.emit('start', { preset: presetKey, total: modelInfo.sizeBytes });

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      // 逐行解析 JSON 事件
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? ''; // 最後一段可能不完整，留著下次解析
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          this.handleEvent(presetKey, event);
        } catch (_err) {
          // 非 JSON 行（不該出現，除非 script bug）→ log warning
          console.warn(`[downloader] 非 JSON 輸出：${trimmed}`);
        }
      }
    });

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
      // 印到主進程 log（debug 用）
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          console.warn(`[downloader:stderr] ${line}`);
        }
      }
    });

    child.on('exit', (code, signal) => {
      const preset = this.currentPreset;
      this.currentChild = null;
      this.currentPreset = null;
      if (this.cancelTimer) {
        clearTimeout(this.cancelTimer);
        this.cancelTimer = null;
      }

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        if (preset) {
          console.log(`[downloader] 下載已取消（${preset}）`);
          this.emit('cancelled', { preset });
        }
        return;
      }

      if (code !== 0) {
        if (preset) {
          const errMsg = `下載進程退出 code=${code} signal=${signal ?? 'none'}`;
          console.error(`[downloader] ${errMsg}`);
          this.emit('error', { preset, code: 'exit_failed', message: errMsg });
        }
      }
    });

    child.on('error', (err) => {
      console.error('[downloader] spawn error:', err);
      this.emit('error', { preset: presetKey, code: 'spawn_error', message: err.message });
      this.currentChild = null;
      this.currentPreset = null;
    });
  }

  /**
   * 取消當前下載（SIGTERM → 3 秒 grace → SIGKILL）
   */
  cancelDownload(): void {
    if (!this.currentChild) return;
    console.log('[downloader] 發送 SIGTERM 給下載進程');
    this.currentChild.kill('SIGTERM');
    // 3 秒後還沒退就強制 kill
    this.cancelTimer = setTimeout(() => {
      if (this.currentChild) {
        console.warn('[downloader] 3 秒 grace 已過，強制 SIGKILL');
        this.currentChild.kill('SIGKILL');
      }
      this.cancelTimer = null;
    }, 3000);
  }

  /**
   * 判斷是否正在下載
   */
  isDownloading(): boolean {
    return this.currentChild !== null;
  }

  /**
   * 取得當前下載中的 preset key
   */
  getCurrentPreset(): string | null {
    return this.currentPreset;
  }

  // ===== private =====

  /**
   * 解析 child stdout 傳來的 JSON 事件，type 為 unknown 避免 any 擴散
   * （用 switch case 處理已知事件，未知事件 log warning）
   */
  private handleEvent(preset: string, event: unknown): void {
    if (typeof event !== 'object' || event === null) {
      console.warn(`[downloader] 事件不是 object：${JSON.stringify(event)}`);
      return;
    }
    const e = event as { event?: string; [key: string]: unknown };
    switch (e.event) {
      case 'start':
        // 已在 startDownload 觸發過，這裡可忽略或補資料
        break;

      case 'progress':
        this.emit('progress', {
          preset,
          phase: e.phase,
          downloaded: e.downloaded,
          total: e.total,
          percent: e.percent,
          speedBps: e.speedBps,
          remainingSec: e.remainingSec,
        } as DownloadProgressEvent);
        break;

      case 'phase':
        // 解壓/cleanup 階段
        this.emit('log', { preset, message: (e.message as string) ?? '' });
        this.emit('progress', {
          preset,
          phase: e.phase as DownloadProgressEvent['phase'],
          downloaded: 0,
          total: 0,
          percent: 0,
          speedBps: 0,
          remainingSec: 0,
          message: e.message as string | undefined,
        } as DownloadProgressEvent);
        break;

      case 'exists':
        this.emit('exists', { preset, path: e.path as string } as DownloadExistsEvent);
        break;

      case 'hash':
        // 算完 hash 還沒比對（只算不驗證的情境，例如 expected 為 null）
        this.emit('verified', {
          preset,
          algorithm: 'sha256',
          actual: e.actual as string,
          expected: (e.expected as string | null) ?? null,
          skipped: (e.skipped as boolean) ?? true,
        } as DownloadVerifiedEvent);
        // TOFU commit 3：若跳過比對（無官方 baseline）→ 自動建 TOFU
        if ((e.skipped as boolean) ?? true) {
          void this.establishAndSaveTofu(preset);
        }
        break;

      case 'verified':
        // 校驗通過（actual === expected）— 有官方 baseline 對得起來，不需建 TOFU
        this.emit('verified', {
          preset,
          algorithm: 'sha256',
          actual: e.actual as string,
          expected: (e.expected as string | null) ?? null,
          skipped: false,
        } as DownloadVerifiedEvent);
        break;

      case 'done':
        this.emit('complete', {
          preset,
          path: e.path as string,
          durationMs: e.durationMs as number,
        } as DownloadCompleteEvent);
        break;

      case 'cancelled':
        this.emit('log', { preset, message: (e.message as string) ?? '已取消' });
        // 真正的 cancelled 事件會在 child exit 時發
        break;

      case 'error':
        this.emit('error', {
          preset,
          code: (e.code as string) ?? 'unknown',
          message: (e.message as string) ?? 'unknown error',
          url: e.url as string | undefined,
          httpStatus: e.httpStatus as number | undefined,
          cause: e.cause as string | undefined,
          timestamp: (e.timestamp as number) ?? Date.now(),
        } as DownloadErrorEvent);
        break;

      case 'list':
        // 不會出現在下載流程中
        break;

      default:
        console.warn(`[downloader] 未知事件：${e.event}`);
    }
  }

  /**
   * 解析 download-model.mjs 實際路徑
   * - dev: <cwd>/scripts/download-model.mjs
   * - packaged: <resources>/app.asar/scripts/download-model.mjs（或 unpacked）
   */
  private resolveScriptPath(): string {
    // 簡化：永遠從 process.cwd() 找（dev + packaged 都成立）
    return join(process.cwd(), 'scripts', 'download-model.mjs');
  }

  // ===== TOFU 自我校驗（commit 3）=====

  /**
   * 自動建立 TOFU baseline 並存進 settings
   * 觸發時機：下載完成且 preset 沒有官方 SHA-256 baseline 時
   *
   * 注意：此時模型目錄已經完整解壓，遞迴算所有檔案 SHA-256
   * 對於 Luigi 4 檔約需 5-10s（串流讀，無爆記憶體）
   */
  private async establishAndSaveTofu(preset: string): Promise<void> {
    try {
      // commit: customModelPath 完整接通 — TOFU 算 hash 也要用自訂下載根目錄
      const customRoot = this.getCustomRootDir();
      const defaultRoot = join(app.getPath('userData'), 'models');
      const modelPath = resolveModelPath(customRoot, defaultRoot, preset);
      if (!existsSync(modelPath)) {
        console.warn(`[downloader] TOFU 建立失敗：模型目錄不存在 ${modelPath}`);
        return;
      }
      const baseline = await establishTofu(modelPath, 'auto');
      // 寫進 settings（shallow merge，注意要保留既有其他 preset 的 baseline）
      const current = appState.getSettings();
      const nextBaselines = {
        ...current.tofuBaselines,
        [preset]: baseline,
      } as typeof current.tofuBaselines;
      appState.updateSettings({ tofuBaselines: nextBaselines });
      console.log(`[downloader] TOFU baseline 已建立：${preset} sha256=${baseline.sha256.slice(0, 16)}…`);
      this.emit('tofuEstablished', { preset, baseline, timestamp: Date.now() });
    } catch (err) {
      console.warn(
        `[downloader] TOFU 建立失敗：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 移除 TOFU baseline（UI 提供「清除 TOFU」按鈕時呼叫）
   * 移除後下次重算會走 no-baseline → mismatch（如果還有檔案的話）
   */
  removeTofu(preset: string): void {
    const current = appState.getSettings();
    if (!(preset in current.tofuBaselines)) {
      return;
    }
    const nextBaselines = { ...current.tofuBaselines } as typeof current.tofuBaselines;
    delete (nextBaselines as Record<string, TofuBaseline>)[preset];
    appState.updateSettings({ tofuBaselines: nextBaselines });
    console.log(`[downloader] TOFU baseline 已移除：${preset}`);
    this.emit('tofuRemoved', { preset, timestamp: Date.now() });
  }

  /**
   * 手動觸發校驗（給 UI「重新校驗」按鈕呼叫）
   * 對所有已下載模型跑 verify，回傳結果 event
   */
  async verifyAll(): Promise<VerificationResult[]> {
    const { verifyModel } = await import('./verifier');
    const results: VerificationResult[] = [];
    const tofuMap = appState.getSettings().tofuBaselines as Record<string, TofuBaseline>;
    for (const m of this.listModels()) {
      if (!m.installed) continue;
      const result = await verifyModel(m.path, {
        officialSha256: m.sha256,
        tofuBaseline: tofuMap[m.key] ?? null,
      });
      results.push(result);
      this.emit('verificationResult', { preset: m.key, result, timestamp: Date.now() });
    }
    return results;
  }
}

/** 單例 */
export const modelDownloader = new ModelDownloader();
