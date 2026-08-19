/**
 * Renderer 入口（P0 階段：只渲染 hello-world 設定頁面）
 *
 * 確認熱鍵能觸發，並從 main 收到廣播。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
