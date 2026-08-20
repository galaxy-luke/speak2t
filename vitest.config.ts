/**
 * Vitest 設定
 *
 * 與 vite.config.ts 平行（vite.config.ts 是給 renderer build 用的，
 * 這裡 vitest 要掃整個 src/ + tests/，不限定 renderer root）。
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
