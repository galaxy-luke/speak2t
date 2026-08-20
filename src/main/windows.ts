/**
 * 主視窗 + 指示器視窗管理
 *
 * P0：只有 settings 視窗
 * P1 階段 4：新增 indicator frameless 浮窗
 */

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { lifecycle } from './lifecycle';
import { appState } from './app-state';

let mainWindow: BrowserWindow | null = null;
let indicatorWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Speak2T 設定',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 開發模式載入 Vite dev server，正式模式載入打包後的 HTML
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 關閉視窗時縮到 tray（不退出 app）
  mainWindow.on('close', (event) => {
    if (!lifecycle.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 指示器浮窗（frameless transparent 視窗）
 * 顯示位置：螢幕底部中央（D-2 預設 bottom-center）
 */
export function createIndicatorWindow(): BrowserWindow {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    return indicatorWindow;
  }

  const { width, x, y } = computeIndicatorPosition();

  indicatorWindow = new BrowserWindow({
    width,
    height: 80,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    hasShadow: false,
    title: 'Speak2T Indicator',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 設定 alwaysOnTop level（螢幕鎖定之上）
  indicatorWindow.setAlwaysOnTop(true, 'screen-saver');
  // 點其他地方不關閉（click-through 由 renderer 處理 setIgnoreMouseEvents）
  indicatorWindow.setVisibleOnAllWorkspaces(true);

  // 載入頁面（query string 切到 indicator view）
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    indicatorWindow.loadURL(`${devServerUrl}?view=indicator`);
  } else {
    indicatorWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'indicator' },
    });
  }

  // 不要在 DevTools 開（debug 開）
  if (process.env.SPEAK2T_DEBUG_INDICATOR_DEVTOOLS === '1') {
    indicatorWindow.webContents.openDevTools({ mode: 'detach' });
  }

  indicatorWindow.on('closed', () => {
    indicatorWindow = null;
  });

  // 跟著設定變化移動位置（D-2 預設 bottom-center，未來可加 follow-cursor）
  appState.on('settings:changed', () => {
    if (indicatorWindow && !indicatorWindow.isDestroyed()) {
      const pos = computeIndicatorPosition();
      indicatorWindow.setBounds({ x: pos.x, y: pos.y, width: pos.width, height: 80 });
    }
  });

  return indicatorWindow;
}

export function getIndicatorWindow(): BrowserWindow | null {
  return indicatorWindow;
}

/**
 * 顯示指示器視窗
 */
export function showIndicator(): void {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) {
    createIndicatorWindow();
  }
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    indicatorWindow.show();
  }
}

/**
 * 隱藏指示器視窗
 */
export function hideIndicator(): void {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    indicatorWindow.hide();
  }
}

/**
 * 計算指示器位置（依 settings.indicatorPosition）
 */
function computeIndicatorPosition(): { x: number; y: number; width: number } {
  const width = 360;
  const height = 80;
  const margin = 32;
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea; // 扣除 taskbar 的工作區
  const settings = appState.getSettings();

  if (settings.indicatorPosition === 'follow-cursor') {
    // 跟隨游標：預設放在游標附近（左下）
    // stage 4 先用簡單實作：放在游標位置的右下方
    const cursor = screen.getCursorScreenPoint();
    return {
      width,
      x: Math.max(workArea.x, Math.min(cursor.x, workArea.x + workArea.width - width)),
      y: Math.max(workArea.y, Math.min(cursor.y + 16, workArea.y + workArea.height - height - margin)),
    };
  }

  // 預設：底部中央
  return {
    width,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - margin,
  };
}
