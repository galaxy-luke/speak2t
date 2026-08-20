/**
 * Postprocess unit tests（P3 Stage 1）
 *
 * 覆蓋每個規則的核心 case + 整合測試。
 */

import { describe, expect, it } from 'vitest';
import { postprocess, postprocessWithReport, DEFAULT_RULES } from '..';

describe('postprocess / trim-whitespace', () => {
  it('移除頭尾空白', () => {
    expect(postprocess('  今天天氣很好  ')).toBe('今天天氣很好。');
  });
  it('移除換行', () => {
    expect(postprocess('\n蘋果\n')).toBe('蘋果。');
  });
  it('空字串保持空字串', () => {
    expect(postprocess('')).toBe('');
  });
});

describe('postprocess / cn-en-space', () => {
  it('中文後接英文加空格', () => {
    expect(postprocess('我今天meeting')).toBe('我今天 meeting。');
  });
  it('英文後接中文加空格', () => {
    expect(postprocess('apple的很好吃')).toBe('apple 的很好吃。');
  });
  it('多個中英交界都加', () => {
    expect(postprocess('我昨天用Python寫了API')).toBe('我昨天用 Python 寫了 API。');
  });
});

describe('postprocess / cn-digit-space', () => {
  it('中文後接數字加空格', () => {
    expect(postprocess('蘋果13')).toBe('蘋果 13。');
  });
  it('數字後接中文加空格', () => {
    expect(postprocess('3個人')).toBe('3 個人。');
  });
  it('小數點不處理', () => {
    // "1.5倍" → trim 後是 "1.5倍"，小數點不應被動
    expect(postprocess('1.5倍')).toBe('1.5倍。');
  });
});

describe('postprocess / comma-normalize', () => {
  it('CJK 間的英文逗號改中文', () => {
    expect(postprocess('蘋果,橘子')).toBe('蘋果，橘子。');
  });
  it('CJK + 英文逗號 + 空白', () => {
    expect(postprocess('今天, 明天')).toBe('今天，明天。');
  });
  it('純英文不動', () => {
    expect(postprocess('Hello, world')).toBe('Hello, world。');
  });
  it('CJK 結尾的英文句號改中文', () => {
    expect(postprocess('蘋果.')).toBe('蘋果。');
  });
});

describe('postprocess / trailing-period', () => {
  it('無標點結尾加句號', () => {
    expect(postprocess('今天天氣很好')).toBe('今天天氣很好。');
  });
  it('已有句號不重複加', () => {
    expect(postprocess('今天天氣很好。')).toBe('今天天氣很好。');
  });
  it('有問號不重複加', () => {
    expect(postprocess('你確定嗎?')).toBe('你確定嗎?');
  });
  it('有驚嘆號不重複加', () => {
    expect(postprocess('太棒了!')).toBe('太棒了!');
  });
  it('有逗號不加（逗號不算句尾標點，但會被判定為有標點）', () => {
    // 中文逗號 `，` 算標點，不重複加
    expect(postprocess('蘋果，橘子')).toBe('蘋果，橘子。');
  });
});

describe('postprocess / collapse-spaces', () => {
  it('連續空格折疊', () => {
    expect(postprocess('蘋果  橘子')).toBe('蘋果 橘子。');
  });
  it('tab 與空白混用折疊', () => {
    expect(postprocess('蘋果 \t 橘子')).toBe('蘋果 橘子。');
  });
});

describe('postprocess / 整合測試', () => {
  it('複合情境：中英中數標點結尾', () => {
    expect(postprocess('我今天meeting蘋果13')).toBe('我今天 meeting 蘋果 13。');
  });

  it('複合情境：標點統一 + 句尾', () => {
    expect(postprocess('今天,明天都好')).toBe('今天，明天都好。');
  });

  it('複合情境：換行 + 中英 + 折疊', () => {
    expect(postprocess('\n我  用 Python\n')).toBe('我 用 Python。');
  });

  it('短字串（≤3 字）安全處理', () => {
    expect(postprocess('你好')).toBe('你好。');
    expect(postprocess('Hi')).toBe('Hi。');
  });
});

describe('postprocess / disabledRules', () => {
  it('關掉 trailing-period 不加句號', () => {
    expect(postprocess('今天天氣很好', { disabledRules: ['trailing-period'] })).toBe('今天天氣很好');
  });

  it('關掉 cn-en-space 不加空格', () => {
    expect(postprocess('我今天meeting', { disabledRules: ['cn-en-space'] })).toBe('我今天meeting。');
  });

  it('全部關掉 = no-op', () => {
    const text = '我今天meeting蘋果13';
    const all = DEFAULT_RULES.map((r) => r.id);
    expect(postprocess(text, { disabledRules: all })).toBe(text);
  });
});

describe('postprocessWithReport', () => {
  it('回傳詳細結果', () => {
    const result = postprocessWithReport('我今天meeting');
    expect(result.original).toBe('我今天meeting');
    expect(result.processed).toBe('我今天 meeting。');
    // trim 沒變化（無頭尾空白），不記錄
    expect(result.appliedRules).not.toContain('trim-whitespace');
    // cn-en-space 改了
    expect(result.appliedRules).toContain('cn-en-space');
    // trailing-period 改了
    expect(result.appliedRules).toContain('trailing-period');
  });

  it('沒有變化時不記錄 appliedRules', () => {
    const result = postprocessWithReport('今天天氣很好。');
    // 已經有句號，trim 沒頭尾空白，都不記錄
    expect(result.appliedRules).not.toContain('trim-whitespace');
    expect(result.appliedRules).not.toContain('trailing-period');
  });

  it('跳過規則列入 skippedRules', () => {
    const result = postprocessWithReport('今天天氣很好', {
      disabledRules: ['trailing-period'],
    });
    expect(result.skippedRules).toContain('trailing-period');
    expect(result.processed).toBe('今天天氣很好');
  });
});
