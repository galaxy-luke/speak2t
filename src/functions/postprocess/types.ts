/**
 * Postprocess types（P3 Stage 1）
 */

/** 一條後處理規則 */
export interface PostprocessRule {
  /** 唯一 ID（用於 disabledRules 黑名單） */
  id: string;
  /** 顯示名稱（給 debug UI 用） */
  name: string;
  /** 簡短描述 */
  description: string;
  /** 純函式：text → text */
  apply: (text: string) => string;
}

/** 後處理選項 */
export interface PostprocessOptions {
  /** 跳過的規則 ID 列表（黑名單） */
  disabledRules?: string[];
}

/** 後處理結果（給 debug 用） */
export interface PostprocessResult {
  original: string;
  processed: string;
  appliedRules: string[];
  skippedRules: string[];
  /** 是否有變化（processed !== original） */
  changed: boolean;
}
