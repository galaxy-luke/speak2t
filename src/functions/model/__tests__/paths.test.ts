/**
 * paths.ts 單元測試（commit: customModelPath 完整接通）
 *
 * 覆蓋：
 * - resolveModelPath：customRoot 有/無/空字串時路徑解析
 * - extractCustomRoot：trim + 空字串/空白/non-string 處理
 *
 * 為什麼要測：downloader.ts / manager.ts 共用這兩個 helper，
 * 任一邊改壞會影響下載路徑、TOFU 算 hash、引擎載入 — 故獨立測。
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveModelPath, extractCustomRoot } from '../paths';

describe('resolveModelPath', () => {
  it('customRoot 有值時用 customRoot', () => {
    const result = resolveModelPath('D:\\MyModels', 'C:\\default\\models', 'sherpa-zh-en');
    expect(result).toBe(join('D:\\MyModels', 'sherpa-zh-en'));
  });

  it('customRoot undefined 時 fallback 到 defaultRoot', () => {
    const result = resolveModelPath(undefined, 'C:\\default\\models', 'sherpa-zh-en');
    expect(result).toBe(join('C:\\default\\models', 'sherpa-zh-en'));
  });

  it('customRoot 空字串時 fallback 到 defaultRoot（透過 extractCustomRoot 處理）', () => {
    // 注意：空字串必須先過 extractCustomRoot 才會 fallback
    // 直接傳 resolveModelPath('', ...) 不會 fallback（因 '' 不是 nullish）
    const customRoot = extractCustomRoot('');
    const result = resolveModelPath(customRoot, 'C:\\default\\models', 'sherpa-zh-en');
    expect(result).toBe(join('C:\\default\\models', 'sherpa-zh-en'));
  });

  it('preset 含底線/數字/英文都正確拼接', () => {
    const result = resolveModelPath(
      'D:\\MyModels',
      'C:\\default',
      'luigi-x-asr-zh-tw-en-ft75m',
    );
    expect(result).toBe(join('D:\\MyModels', 'luigi-x-asr-zh-tw-en-ft75m'));
  });

  it('customRoot 用 POSIX 斜線也能正確拼接', () => {
    const result = resolveModelPath('/tmp/models', '/var/userdata', 'preset-a');
    // path.join 會自動 normalize — Windows 上變 \\，POSIX 上變 /
    expect(result).toBe(join('/tmp/models', 'preset-a'));
  });
});

describe('extractCustomRoot', () => {
  it('非空字串回傳 trimmed', () => {
    expect(extractCustomRoot('  D:\\MyModels  ')).toBe('D:\\MyModels');
  });

  it('undefined 回傳 undefined', () => {
    expect(extractCustomRoot(undefined)).toBeUndefined();
  });

  it('空字串回傳 undefined', () => {
    expect(extractCustomRoot('')).toBeUndefined();
  });

  it('全空白回傳 undefined', () => {
    expect(extractCustomRoot('   ')).toBeUndefined();
    expect(extractCustomRoot('\t\n')).toBeUndefined();
  });

  it('非 string 型別回傳 undefined', () => {
    expect(extractCustomRoot(123)).toBeUndefined();
    expect(extractCustomRoot(null)).toBeUndefined();
    expect(extractCustomRoot({})).toBeUndefined();
    expect(extractCustomRoot([])).toBeUndefined();
    expect(extractCustomRoot(true)).toBeUndefined();
  });

  it('已 trim 的字串保持原樣', () => {
    expect(extractCustomRoot('D:\\MyModels')).toBe('D:\\MyModels');
  });

  it('POSIX 路徑不影響 trim', () => {
    expect(extractCustomRoot('  /tmp/models  ')).toBe('/tmp/models');
  });
});
