/**
 * 連續空白折疊成單個
 *
 * 範例：
 *   "今天  天氣"   → "今天 天氣"
 *   "蘋果\t橘子"   → "蘋果 橘子"
 *   "蘋果\n橘子"   → "蘋果 橘子"（換行變空格，與講話習慣一致）
 *   "蘋果  橘子\n" → "蘋果 橘子"（先 collapse 再 trim）
 *
 * 順序：先 collapse，最後一步做（避免影響其他規則的判斷）
 */

const MULTI_WS_PATTERN = /[ \t\n\r]+/g;

export const collapseSpacesRule = {
  id: 'collapse-spaces',
  name: '折疊連續空白',
  description: '連續的空格、tab、換行折疊成單個空格',
  apply: (text: string): string => {
    return text.replace(MULTI_WS_PATTERN, ' ');
  },
};
