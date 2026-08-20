/**
 * 句尾無標點 → 加句號
 *
 * 範例：
 *   "今天天氣很好"   → "今天天氣很好。"
 *   "今天天氣很好。" → 不動
 *   "今天天氣很好!"  → 不動
 *   "你確定嗎?"      → 不動
 *
 * 規則：若最後一個字元不是任何標點（。！？，.!?;:），加中文句號。
 */

const TRAILING_PUNCTUATION = /[。！？，.!?;:：、]$/;

export const trailingPeriodRule = {
  id: 'trailing-period',
  name: '句尾加句號',
  description: '若句尾無標點，自動加中文句號「。」',
  apply: (text: string): string => {
    const trimmed = text.trimEnd();
    if (!trimmed) return text;
    if (TRAILING_PUNCTUATION.test(trimmed)) return text;
    return `${trimmed}。`;
  },
};
