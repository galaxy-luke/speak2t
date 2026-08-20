/**
 * 頭尾空白 trim
 *
 * 範例：
 *   " 今天 "   → "今天"
 *   "蘋果\n"   → "蘋果"
 *
 * 順序：第一步做（先清乾淨邊界）
 */

export const trimWhitespaceRule = {
  id: 'trim-whitespace',
  name: '頭尾空白 trim',
  description: '移除字串頭尾的空白、tab、換行',
  apply: (text: string): string => {
    return text.trim();
  },
};
