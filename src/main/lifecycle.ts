/**
 * App 生命週期 flag
 *
 * 獨立模組避免 circular import。
 */

export const lifecycle = {
  /** 是否正在退出（區分「關視窗」vs「真的退出」） */
  isQuitting: false,
};
