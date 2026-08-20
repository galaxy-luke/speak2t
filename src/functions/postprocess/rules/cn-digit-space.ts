/**
 * 中文與數字之間加空格
 *
 * 範例：
 *   "蘋果13"    → "蘋果 13"
 *   "3個人"     → "3 個人"
 *   "iPhone 15" → 不動（純英數之間不處理）
 *
 * 注意：
 *   - 小數點 `3.14` 不處理（`.` 後面是數字）
 *   - 數字串 `123` 之間不處理
 *   - 純英文數字 `Win32` 不處理
 */

const CN = '\\u4e00-\\u9fff';
const DIGIT = '0-9';

// 注意 (?<!\.)：排除小數點前的數字，避免 `1.5倍` 被拆成 `1.5 倍`
const CN_DIGIT_PATTERN = new RegExp(
  `(?<!\\.)([${CN}])([${DIGIT}])|(?<!\\.)([${DIGIT}])([${CN}])`,
  'g',
);

export const cnDigitSpaceRule = {
  id: 'cn-digit-space',
  name: '中數之間加空格',
  description: '中文與數字交界處加空格（不含小數點上下文）',
  apply: (text: string): string => {
    return text.replace(CN_DIGIT_PATTERN, (match, cn1, d1, d2, cn2) => {
      if (cn1) return `${cn1} ${d1}`;
      if (d2) return `${d2} ${cn2}`;
      return match;
    });
  },
};
