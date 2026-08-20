/**
 * 模型路徑解析（commit: customModelPath 完整接通）
 *
 * 三處共用邏輯（避免漂移）：
 * - downloader.ts: listModels() / establishAndSaveTofu() / startDownload() spawn env
 * - manager.ts: resolveModelDir()
 * - （sherpa-onnx.ts / whisper-cpp.ts engine 內部也做 customPath > modelDir fallback）
 *
 * 優先序：
 * 1. customRoot（settings.customModelPath，trim + 非空才用）
 * 2. defaultRoot（<userData>/models）
 *
 * 注意：customRoot 是「根目錄」，每個 preset 裝在 `<customRoot>/<preset>` 子目錄
 * 而不是「單一模型路徑」— 這是 UI 「自訂模型路徑」欄位的真實語意。
 */
import { join } from 'node:path';

/**
 * 計算模型路徑
 *
 * 注意：customRoot 必須先用 `extractCustomRoot` 處理過（trim + 空字串 → undefined）
 * 直接傳 `''` 不會 fallback（因 `''` 不是 nullish）。Callers 範例：
 * ```ts
 * const customRoot = extractCustomRoot(settings.customModelPath);
 * const path = resolveModelPath(customRoot, defaultRoot, preset);
 * ```
 *
 * @param customRoot 自訂下載根目錄（建議先過 extractCustomRoot，否則空字串會壞掉）
 * @param defaultRoot 預設下載根目錄（<userData>/models）
 * @param preset preset 名稱（=解壓後目錄名）
 * @returns 完整模型路徑
 */
export function resolveModelPath(
  customRoot: string | undefined,
  defaultRoot: string,
  preset: string,
): string {
  return join(customRoot ?? defaultRoot, preset);
}

/**
 * 從 settings 抽出有效 customRoot
 * - non-string → undefined
 * - 空字串 / 全空白 → undefined
 * - 否則回傳 trimmed 字串
 */
export function extractCustomRoot(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed;
}
