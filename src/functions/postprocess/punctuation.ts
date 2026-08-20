/**
 * 標點自動修正主函式（P3 Stage 1）
 *
 * 規則執行順序很重要：
 * 1. trim（清邊界）
 * 2. cn-en-space（中英空格）
 * 3. cn-digit-space（中數空格）
 * 4. comma-normalize（標點統一）
 * 5. trailing-period（句尾句號）
 * 6. collapse-spaces（折疊空白，最後做，避免影響前面規則判斷）
 *
 * 注意：規則順序若改變，結果可能不同。改順序必須 review 對應 unit test。
 */

import { trimWhitespaceRule } from './rules/trim-whitespace';
import { cnEnSpaceRule } from './rules/cn-en-space';
import { cnDigitSpaceRule } from './rules/cn-digit-space';
import { commaNormalizeRule } from './rules/comma-normalize';
import { trailingPeriodRule } from './rules/trailing-period';
import { collapseSpacesRule } from './rules/collapse-spaces';
import type { PostprocessOptions, PostprocessResult, PostprocessRule } from './types';

/** 預設規則清單（執行順序） */
export const DEFAULT_RULES: PostprocessRule[] = [
  trimWhitespaceRule,
  cnEnSpaceRule,
  cnDigitSpaceRule,
  commaNormalizeRule,
  trailingPeriodRule,
  collapseSpacesRule,
];

/**
 * 套用後處理（純函式）
 *
 * @param input 原始 ASR 文字
 * @param options.disabledRules 跳過的規則 ID 列表
 * @returns 修正後文字
 */
export function postprocess(input: string, options?: PostprocessOptions): string {
  if (!input) return input;

  const disabled = new Set(options?.disabledRules ?? []);

  let text = input;
  for (const rule of DEFAULT_RULES) {
    if (disabled.has(rule.id)) continue;
    text = rule.apply(text);
  }
  return text;
}

/**
 * 套用後處理並回傳詳細結果（給 debug UI 用）
 */
export function postprocessWithReport(
  input: string,
  options?: PostprocessOptions,
): PostprocessResult {
  if (!input) {
    return {
      original: input,
      processed: input,
      appliedRules: [],
      skippedRules: [],
      changed: false,
    };
  }

  const disabled = new Set(options?.disabledRules ?? []);
  const appliedRules: string[] = [];
  const skippedRules: string[] = [];

  let text = input;
  for (const rule of DEFAULT_RULES) {
    if (disabled.has(rule.id)) {
      skippedRules.push(rule.id);
      continue;
    }
    const before = text;
    text = rule.apply(text);
    if (text !== before) {
      appliedRules.push(rule.id);
    }
  }

  return {
    original: input,
    processed: text,
    appliedRules,
    skippedRules,
    changed: text !== input,
  };
}
