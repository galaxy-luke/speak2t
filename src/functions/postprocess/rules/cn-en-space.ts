/**
 * 中英之間加空格
 *
 * 範例：
 *   "我今天meeting" → "我今天 meeting"
 *   "apple的"       → "apple 的"
 *
 * 已知 trade-off（可接受）：
 *   "iPhone很好用"   → "i Phone 很好用"（iPhone 會被拆）
 *   "e-mail帳號"     → "e-mail 帳號"（e-mail 會被拆）
 *
 * 完整排除清單需要 hot-word 表（O-2 已砍詞彙表），目前不處理。
 */

/** CJK Unified Ideographs 基本範圍 */
const CN = '\\u4e00-\\u9fff';
const EN = 'a-zA-Z';

const CN_EN_PATTERN = new RegExp(
  `([${CN}])([${EN}])|([${EN}])([${CN}])`,
  'g',
);

export const cnEnSpaceRule = {
  id: 'cn-en-space',
  name: '中英之間加空格',
  description: '中文與英文字母交界處加空格',
  apply: (text: string): string => {
    return text.replace(CN_EN_PATTERN, (match, cn1, en1, en2, cn2) => {
      // case 1: 中文 + 英文
      if (cn1) return `${cn1} ${en1}`;
      // case 2: 英文 + 中文
      if (en2) return `${en2} ${cn2}`;
      return match;
    });
  },
};
