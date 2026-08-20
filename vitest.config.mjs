/**
 * Vitest 設定
 *
 * 與 vite.config.mjs 平行（vite.config.mjs 是給 renderer build 用的，
 * 這裡 vitest 要掃整個 src/ + tests/，不限定 renderer root）。
 */

import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
