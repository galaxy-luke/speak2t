/**
 * 英文逗號 / 句號統一為中文標點
 *
 * 範例：
 *   "hello,world"     → "hello，world"
 *   "蘋果,橘子"       → "蘋果，橘子"
 *   "今天,明天"       → "今天，明天"
 *   "1.5倍"          → 不動（數字小數點）
 *   "1.蘋果"         → 不動（清單編號 1.）
 *
 * 啟動條件（避免誤傷英文書寫）：
 *   - 逗號前後都是 CJK 字符 → 改為中文逗號
 *   - 句號在 CJK 句子結尾（後面是 CJK 或字串結尾）→ 改為中文句號
 *
 * 注意：純英文寫作 `Hello, world` 不會被改（無 CJK 觸發條件）。
 */

const CN = '\\u4e00-\\u9fff';
// CJK 後接逗號再接 CJK
const CN_COMMA_CN = new RegExp(`([${CN}]),([${CN}])`, 'g');
// CJK 後接逗號再接空白
const CN_COMMA_SPACE = new RegExp(`([${CN}]),\\s`, 'g');
// CJK 後接句號再接 CJK
const CN_PERIOD_CN = new RegExp(`([${CN}])\\.([${CN}])`, 'g');
// CJK 結尾接句號（字串結尾）
const CN_END_PERIOD = new RegExp(`([${CN}])\\.$`, 'g');

export const commaNormalizeRule = {
  id: 'comma-normalize',
  name: '中英標點統一',
  description: 'CJK 上下文中的英文逗號 / 句號統一為中文標點',
  apply: (text: string): string => {
    return text
      .replace(CN_COMMA_CN, '$1，$2')
      .replace(CN_COMMA_SPACE, '$1，')
      .replace(CN_PERIOD_CN, '$1。$2')
      .replace(CN_END_PERIOD, '$1。');
  },
};
