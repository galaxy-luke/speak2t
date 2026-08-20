/**
 * Renderer 入口
 *
 * 根據 URL query string ?view=indicator 切換渲染 settings 頁面或 indicator 浮窗。
 * 兩個 view 共用 vite dev server 同一個 entry。
 */

import { useEffect, useState } from 'react';
import { SettingsApp } from './settings/SettingsApp';
import { IndicatorApp } from './indicator/IndicatorApp';
import './styles.css';

function getViewFromUrl(): 'settings' | 'indicator' {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  return view === 'indicator' ? 'indicator' : 'settings';
}

export function App() {
  const [view, setView] = useState<'settings' | 'indicator'>(() => getViewFromUrl());

  // 處理 query string 變化（dev 模式可能 reload 觸發）
  useEffect(() => {
    const onPopState = () => setView(getViewFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (view === 'indicator') {
    return <IndicatorApp />;
  }
  return <SettingsApp />;
}
