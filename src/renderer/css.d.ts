/**
 * CSS module ambient declarations
 *
 * Vite 處理 CSS import，但 tsc 不知道。
 * 加這個讓 typecheck 通過。
 */

declare module '*.css';
