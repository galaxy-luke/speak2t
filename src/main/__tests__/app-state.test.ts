/**
 * app-state.ts 單元測試
 *
 * 測試 loadSettings / saveSettings / status change event。
 * 用 vi.mock 隔離 electron app 模組。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock electron before importing app-state
let mockUserDataDir = '';
vi.mock('electron', () => ({
  app: {
    getPath: () => mockUserDataDir,
  },
}));

// Import after mock
const { AppState } = await import('../app-state');
const { DEFAULT_SETTINGS } = await import('../../shared/types');

describe('AppState', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'speak2t-test-'));
    mockUserDataDir = tmpDir;
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('loadSettingsFromDisk', () => {
    it('檔案不存在時用 DEFAULT_SETTINGS', () => {
      const state = new AppState();
      const settings = state.getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('檔案存在時讀取內容', () => {
      const customSettings = { ...DEFAULT_SETTINGS, hotkey: 'Alt+X' };
      writeFileSync(join(tmpDir, 'settings.json'), JSON.stringify(customSettings), 'utf-8');
      const state = new AppState();
      expect(state.getSettings().hotkey).toBe('Alt+X');
    });

    it('檔案 JSON 損壞時 fallback DEFAULT', () => {
      writeFileSync(join(tmpDir, 'settings.json'), 'not valid json', 'utf-8');
      const state = new AppState();
      expect(state.getSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('缺少新欄位時合併 DEFAULT', () => {
      const partial = { hotkey: 'Alt+X' };
      writeFileSync(join(tmpDir, 'settings.json'), JSON.stringify(partial), 'utf-8');
      const state = new AppState();
      const settings = state.getSettings();
      expect(settings.hotkey).toBe('Alt+X');
      // 其他欄位從 DEFAULT 補
      expect(settings.asrEngine).toBe(DEFAULT_SETTINGS.asrEngine);
      expect(settings.postprocessEnabled).toBe(DEFAULT_SETTINGS.postprocessEnabled);
    });
  });

  describe('saveSettingsToDisk', () => {
    it('updateSettings 寫到磁碟', () => {
      const state = new AppState();
      state.updateSettings({ hotkey: 'Alt+X' });
      expect(existsSync(join(tmpDir, 'settings.json'))).toBe(true);
      const raw = readFileSync(join(tmpDir, 'settings.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.hotkey).toBe('Alt+X');
    });

    it('userData 目錄不存在時自動建立', () => {
      const deeperDir = join(tmpDir, 'subdir', 'deeper');
      mockUserDataDir = deeperDir;
      const state = new AppState();
      state.updateSettings({ hotkey: 'Alt+Y' });
      expect(existsSync(join(deeperDir, 'settings.json'))).toBe(true);
    });

    it('寫入時用 pretty print (2 spaces)', () => {
      const state = new AppState();
      state.updateSettings({ hotkey: 'Alt+Z' });
      const raw = readFileSync(join(tmpDir, 'settings.json'), 'utf-8');
      expect(raw).toContain('\n  '); // 有縮排
    });
  });

  describe('getSettings', () => {
    it('回傳 copy（不影響內部狀態）', () => {
      const state = new AppState();
      const s1 = state.getSettings();
      s1.hotkey = 'MUTATED';
      const s2 = state.getSettings();
      expect(s2.hotkey).toBe(DEFAULT_SETTINGS.hotkey);
    });
  });

  describe('updateSettings', () => {
    it('合併 partial 到現有 settings', () => {
      const state = new AppState();
      state.updateSettings({ hotkey: 'Alt+X' });
      state.updateSettings({ autoStart: true });
      const settings = state.getSettings();
      expect(settings.hotkey).toBe('Alt+X');
      expect(settings.autoStart).toBe(true);
    });

    it('觸發 settings:changed event', () => {
      const state = new AppState();
      const handler = vi.fn();
      state.on('settings:changed', handler);
      state.updateSettings({ hotkey: 'Alt+X' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ hotkey: 'Alt+X' }));
    });
  });

  describe('status', () => {
    it('初始狀態為 idle', () => {
      const state = new AppState();
      expect(state.getStatus()).toBe('idle');
    });

    it('setStatus 觸發 status:changed event', () => {
      const state = new AppState();
      const handler = vi.fn();
      state.on('status:changed', handler);
      state.setStatus('recording');
      expect(handler).toHaveBeenCalledWith('recording', 'idle');
    });

    it('setStatus 相同狀態不觸發 event', () => {
      const state = new AppState();
      const handler = vi.fn();
      state.on('status:changed', handler);
      state.setStatus('idle'); // 已經是 idle
      expect(handler).not.toHaveBeenCalled();
    });

    it('getStatus 回傳當前狀態', () => {
      const state = new AppState();
      state.setStatus('processing');
      expect(state.getStatus()).toBe('processing');
    });
  });
});
