/**
 * audio/ingest.ts 單元測試
 *
 * 測試：
 * - start/stop 狀態機
 * - feed() 觸發 level / chunk events
 * - level 計算（peak amplitude）
 * - 沒在 recording 時 feed 不做事
 * - stop 沒在 recording 時回傳 null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron before import
let mockUserDataDir = '/tmp/speak2t-test';
vi.mock('electron', () => ({
  app: {
    getPath: () => mockUserDataDir,
  },
}));

const { AudioIngest } = await import('../ingest');

describe('AudioIngest', () => {
  beforeEach(() => {
    // 確保 SPEAK2T_DEBUG_WAV 沒被設到，否則會寫檔
    delete process.env.SPEAK2T_DEBUG_WAV;
  });

  describe('start/stop 狀態機', () => {
    it('初始不是 recording', () => {
      const ingest = new AudioIngest();
      expect(ingest.recording).toBe(false);
    });

    it('start 後變 recording', () => {
      const ingest = new AudioIngest();
      ingest.start();
      expect(ingest.recording).toBe(true);
    });

    it('stop 後變回非 recording', () => {
      const ingest = new AudioIngest();
      ingest.start();
      ingest.stop();
      expect(ingest.recording).toBe(false);
    });

    it('stop 沒在 recording 時回傳 null', () => {
      const ingest = new AudioIngest();
      expect(ingest.stop()).toBeNull();
    });

    it('start 不影響 buffer 之前的內容（會重置）', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const samples = new Float32Array([0.1, 0.2, 0.3]);
      ingest.feed(samples, 16000);
      ingest.stop();
      // 第二次 start 會清空
      ingest.start();
      // 沒有新 feed → stop 應該是 0 samples
      const result = ingest.stop();
      expect(result?.sampleCount).toBe(0);
    });
  });

  describe('stop 回傳值', () => {
    it('回傳 durationMs 與 sampleCount', () => {
      const ingest = new AudioIngest();
      ingest.start();
      // 1600 samples @ 16kHz = 100ms
      const samples = new Float32Array(1600);
      ingest.feed(samples, 16000);
      const result = ingest.stop();
      expect(result).toEqual({ durationMs: 100, sampleCount: 1600 });
    });

    it('多次 feed 累加 sampleCount', () => {
      const ingest = new AudioIngest();
      ingest.start();
      ingest.feed(new Float32Array(1000), 16000);
      ingest.feed(new Float32Array(2000), 16000);
      ingest.feed(new Float32Array(500), 16000);
      const result = ingest.stop();
      expect(result?.sampleCount).toBe(3500);
      expect(result?.durationMs).toBeCloseTo(218.75, 1);
    });

    it('不同 sample rate 算出的 duration 正確', () => {
      const ingest = new AudioIngest();
      ingest.start();
      // 8000 samples @ 8kHz = 1000ms
      ingest.feed(new Float32Array(8000), 8000);
      const result = ingest.stop();
      expect(result?.durationMs).toBe(1000);
    });
  });

  describe('feed() events', () => {
    it('沒在 recording 時不 emit 任何 event', () => {
      const ingest = new AudioIngest();
      const levelHandler = vi.fn();
      const chunkHandler = vi.fn();
      ingest.on('level', levelHandler);
      ingest.on('chunk', chunkHandler);

      const samples = new Float32Array([0.1, 0.2, 0.3]);
      ingest.feed(samples, 16000);

      expect(levelHandler).not.toHaveBeenCalled();
      expect(chunkHandler).not.toHaveBeenCalled();
    });

    it('在 recording 時 emit level + chunk', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      const chunkHandler = vi.fn();
      ingest.on('level', levelHandler);
      ingest.on('chunk', chunkHandler);

      const samples = new Float32Array([0.1, 0.2, 0.3]);
      ingest.feed(samples, 16000);

      expect(levelHandler).toHaveBeenCalledTimes(1);
      expect(chunkHandler).toHaveBeenCalledTimes(1);
      expect(chunkHandler).toHaveBeenCalledWith(samples, 16000);
    });

    it('多次 feed 觸發多次 events', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      ingest.on('level', levelHandler);

      ingest.feed(new Float32Array(100), 16000);
      ingest.feed(new Float32Array(100), 16000);
      ingest.feed(new Float32Array(100), 16000);

      expect(levelHandler).toHaveBeenCalledTimes(3);
    });
  });

  describe('level 計算（peak amplitude）', () => {
    it('level 等於最大絕對值', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      ingest.on('level', levelHandler);

      const samples = new Float32Array([0.1, 0.5, -0.8, 0.3, 0.2]);
      ingest.feed(samples, 16000);

      const [arg] = levelHandler.mock.calls[0];
      expect(arg).toBeCloseTo(0.8, 5);
    });

    it('level 0.0 for 全零', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      ingest.on('level', levelHandler);

      ingest.feed(new Float32Array([0, 0, 0, 0]), 16000);

      expect(levelHandler).toHaveBeenCalledWith(0);
    });

    it('level 1.0 for 滿刻度', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      ingest.on('level', levelHandler);

      ingest.feed(new Float32Array([0.5, 1.0, -0.5]), 16000);

      const [arg] = levelHandler.mock.calls[0];
      expect(arg).toBeCloseTo(1.0, 5);
    });

    it('負值取絕對值', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      ingest.on('level', levelHandler);

      ingest.feed(new Float32Array([-0.3, -0.1, 0.05]), 16000);

      const [arg] = levelHandler.mock.calls[0];
      expect(arg).toBeCloseTo(0.3, 5);
    });

    it('每次 feed emit 對應那次的 peak（不是累加）', () => {
      const ingest = new AudioIngest();
      ingest.start();
      const levelHandler = vi.fn();
      ingest.on('level', levelHandler);

      ingest.feed(new Float32Array([0.1, 0.2]), 16000); // peak 0.2
      ingest.feed(new Float32Array([0.5, 0.6]), 16000); // peak 0.6
      ingest.feed(new Float32Array([0.05, 0.1]), 16000); // peak 0.1

      expect(levelHandler.mock.calls[0][0]).toBeCloseTo(0.2, 5);
      expect(levelHandler.mock.calls[1][0]).toBeCloseTo(0.6, 5);
      expect(levelHandler.mock.calls[2][0]).toBeCloseTo(0.1, 5);
    });
  });

  describe('debug wav 寫檔', () => {
    it('SPEAK2T_DEBUG_WAV 未設時不寫檔', async () => {
      const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      const tmpDir = mkdtempSync(join(tmpdir(), 'speak2t-test-'));
      mockUserDataDir = tmpDir;
      delete process.env.SPEAK2T_DEBUG_WAV;

      const ingest = new AudioIngest();
      ingest.start();
      ingest.feed(new Float32Array(100), 16000);
      ingest.stop();

      // 沒有 debug 目錄 = 沒寫 wav
      expect(existsSync(join(tmpDir, 'debug'))).toBe(false);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
