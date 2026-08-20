/**
 * ESLint 設定（flat config，ESLint 9+）
 */

import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', '**/*.d.ts', 'scripts/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: '18' },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-console': 'off',
    },
  },
  {
    // 允許 EventEmitter 的 class + interface declaration merging 模式
    // （TypeScript 官方推薦的強型別 EventEmitter pattern）
    // 涵蓋：asr/manager, asr/sherpa-onnx, asr/whisper-cpp, audio/ingest,
    //      hotkey/manager, model/downloader
    files: [
      'src/functions/asr/manager.ts',
      'src/functions/asr/sherpa-onnx.ts',
      'src/functions/asr/whisper-cpp.ts',
      'src/functions/audio/ingest.ts',
      'src/functions/hotkey/manager.ts',
      'src/functions/model/downloader.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
    },
  },
];
