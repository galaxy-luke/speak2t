/**
 * verifier.ts 單元測試（commit 7）
 *
 * 覆蓋：
 * - hashFile：基本 SHA-256
 * - hashModelPath：單檔 / 目錄 / deterministic（檔名排序）
 * - verifyModel：5 種 status + 路徑不存在
 * - establishTofu：建立 + timestamp + source
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashFile,
  hashModelPath,
  verifyModel,
  establishTofu,
} from '../verifier';
import type { TofuBaseline } from '../../../../shared/types';

describe('verifier', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'speak2t-verifier-'));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('hashFile', () => {
    it('算單檔 SHA-256 正確', async () => {
      const p = join(tmpDir, 'a.txt');
      writeFileSync(p, 'hello world', 'utf-8');
      const hash = await hashFile(p);
      // SHA-256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
      expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    });

    it('空檔案 hash = SHA-256("")', async () => {
      const p = join(tmpDir, 'empty.bin');
      writeFileSync(p, '');
      const hash = await hashFile(p);
      // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('二進位檔案正確', async () => {
      const p = join(tmpDir, 'bin.dat');
      writeFileSync(p, Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));
      const hash = await hashFile(p);
      expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('hashModelPath', () => {
    it('單檔路徑 → 算單檔 hash', async () => {
      const p = join(tmpDir, 'model.bin');
      writeFileSync(p, 'sherpa-onnx');
      const result = await hashModelPath(p);
      expect(result.size).toBe(11);
      expect(result.perFile).toHaveLength(1);
      expect(result.perFile[0].name).toBe('model.bin');
      expect(result.perFile[0].size).toBe(11);
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('目錄 → 依檔名排序每檔 hash 再 concat', async () => {
      const dir = join(tmpDir, 'model');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'encoder.onnx'), 'encoder');
      writeFileSync(join(dir, 'decoder.onnx'), 'decoder');
      writeFileSync(join(dir, 'joiner.onnx'), 'joiner');
      writeFileSync(join(dir, 'tokens.txt'), 'tokens');

      const result = await hashModelPath(dir);
      expect(result.size).toBe(7 + 7 + 6 + 6);
      expect(result.perFile).toHaveLength(4);
      // 依檔名排序：decoder / encoder / joiner / tokens
      expect(result.perFile[0].name).toBe('decoder.onnx');
      expect(result.perFile[3].name).toBe('tokens.txt');
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('deterministic：相同內容不管讀取順序都同 hash', async () => {
      const dir1 = join(tmpDir, 'a');
      const dir2 = join(tmpDir, 'b');
      mkdirSync(dir1, { recursive: true });
      mkdirSync(dir2, { recursive: true });
      // 兩個目錄放同樣的檔案，檔名都一樣
      for (const name of ['c.txt', 'a.txt', 'b.txt']) {
        writeFileSync(join(dir1, name), name);
        writeFileSync(join(dir2, name), name);
      }
      const r1 = await hashModelPath(dir1);
      const r2 = await hashModelPath(dir2);
      expect(r1.hash).toBe(r2.hash);
    });

    it('空目錄 → size=0, perFile=[]', async () => {
      const dir = join(tmpDir, 'empty');
      mkdirSync(dir, { recursive: true });
      const result = await hashModelPath(dir);
      expect(result.size).toBe(0);
      expect(result.perFile).toHaveLength(0);
      expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('verifyModel', () => {
    it('檔案不存在 → not-installed', async () => {
      const result = await verifyModel(join(tmpDir, 'nope'), {
        officialSha256: 'abc',
        tofuBaseline: null,
      });
      expect(result.status).toBe('not-installed');
      expect(result.actualHash).toBeNull();
    });

    it('無 baseline → no-baseline', async () => {
      const p = join(tmpDir, 'm.bin');
      writeFileSync(p, 'data');
      const result = await verifyModel(p, {
        officialSha256: null,
        tofuBaseline: null,
      });
      expect(result.status).toBe('no-baseline');
      expect(result.actualHash).not.toBeNull();
    });

    it('官方 baseline 對得起來 → official-verified', async () => {
      const p = join(tmpDir, 'm.bin');
      writeFileSync(p, 'hello');
      const actual = await hashFile(p);
      const result = await verifyModel(p, {
        officialSha256: actual,
        tofuBaseline: null,
      });
      expect(result.status).toBe('official-verified');
      expect(result.actualHash).toBe(actual);
    });

    it('官方 baseline 對不起來 → mismatch', async () => {
      const p = join(tmpDir, 'm.bin');
      writeFileSync(p, 'hello');
      const result = await verifyModel(p, {
        officialSha256: '0'.repeat(64),
        tofuBaseline: null,
      });
      expect(result.status).toBe('mismatch');
    });

    it('TOFU baseline 對得起來 → tofu-verified', async () => {
      const p = join(tmpDir, 'm.bin');
      writeFileSync(p, 'hello');
      const actual = await hashFile(p);
      const tofu: TofuBaseline = {
        sha256: actual,
        sizeBytes: 5,
        establishedAt: '2026-08-20T00:00:00.000Z',
        source: 'auto',
      };
      const result = await verifyModel(p, {
        officialSha256: null,
        tofuBaseline: tofu,
      });
      expect(result.status).toBe('tofu-verified');
    });

    it('TOFU baseline 對不起來 → mismatch', async () => {
      const p = join(tmpDir, 'm.bin');
      writeFileSync(p, 'hello');
      const tofu: TofuBaseline = {
        sha256: '0'.repeat(64),
        sizeBytes: 5,
        establishedAt: '2026-08-20T00:00:00.000Z',
        source: 'auto',
      };
      const result = await verifyModel(p, {
        officialSha256: null,
        tofuBaseline: tofu,
      });
      expect(result.status).toBe('mismatch');
    });

    it('官方 baseline 優先於 TOFU：對得起來走 official-verified', async () => {
      const p = join(tmpDir, 'm.bin');
      writeFileSync(p, 'hello');
      const actual = await hashFile(p);
      const result = await verifyModel(p, {
        officialSha256: actual, // 對得起來
        tofuBaseline: {
          sha256: '0'.repeat(64), // 對不起來
          sizeBytes: 5,
          establishedAt: '2026-08-20T00:00:00.000Z',
          source: 'auto',
        },
      });
      expect(result.status).toBe('official-verified');
    });

    it('目錄校驗：跟 hashModelPath 結果一致', async () => {
      const dir = join(tmpDir, 'multi');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a.onnx'), 'aaa');
      writeFileSync(join(dir, 'b.onnx'), 'bbb');
      const { hash, size } = await hashModelPath(dir);
      const result = await verifyModel(dir, {
        officialSha256: hash,
        tofuBaseline: null,
      });
      expect(result.status).toBe('official-verified');
      expect(result.actualHash).toBe(hash);
      expect(result.fileSize).toBe(size);
    });
  });

  describe('establishTofu', () => {
    it('建立 baseline + 自動填 timestamp + source', async () => {
      const p = join(tmpDir, 'model');
      writeFileSync(p, 'test');
      const before = new Date().toISOString();
      const baseline = await establishTofu(p, 'auto');
      const after = new Date().toISOString();
      expect(baseline.source).toBe('auto');
      expect(baseline.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(baseline.sizeBytes).toBe(4);
      // timestamp 介於 before / after 之間
      expect(baseline.establishedAt >= before).toBe(true);
      expect(baseline.establishedAt <= after).toBe(true);
    });

    it('source=manual 也支援', async () => {
      const p = join(tmpDir, 'm');
      writeFileSync(p, 'x');
      const baseline = await establishTofu(p, 'manual');
      expect(baseline.source).toBe('manual');
    });
  });
});
