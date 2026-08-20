# Speak2T

> 為台灣繁體中文使用者打造的桌面語音輸入工具 — 本機處理、隱私優先。

按一下全域快捷鍵，講話，再按一下，文字自動寫入當前焦點視窗游標處。

## 📊 目前進度

**P0 ✅ P1 ✅ P2 ✅ P3 ✅ P4 ✅** — 完整發布就緒：Windows NSIS installer 121MB + 自動更新 + macOS 文檔  
**P5（可選）** — 多段錄音歷史、客製化指示器主題、CLI 模式

完整階段狀態見 [`SPEC.md`](./SPEC.md) 與 [`CHANGELOG.md`](./CHANGELOG.md)。

## ✨ 特色

- 🎙️ **本機語音辨識** — 雙引擎可選：
  - `sherpa-onnx-streaming-zh-en`（預設，低延遲 100-300ms，~340MB）
  - `whisper.cpp` 離線（備援，高繁中品質，~460MB）
- 🈚 **繁中 + 中英混講** — 預設模型支援中英混講
- ⚡ **Toggle 模式** — 按一下開始、再按一下停止
- 🎯 **兩種注入方式** — 純剪貼簿（手動 Ctrl+V） / 剪貼簿 + 自動 Ctrl+V（預設）
- 🔔 **frameless 指示器浮窗** — 螢幕底部中央，含即時音量 + partial 文字
- 🎙️ **麥克風設備選擇** — 自動偵測新插入硬體（devicechange event）
- 🪟 **系統匣常駐** — 不干擾工作、需要時隨叫隨到
- 🛠️ **獨立設定主視窗** — navbar + 4 tab（一般/ASR/麥克風/進階），form draft 模式
- 📥 **UI 內建模型下載** — 進度條 + 取消 + 完成自動載入
- 🚀 **開機自動啟動**（可選）— 設定 toggle，Windows 寫 registry
- ✨ **標點自動修正**（P3）— `我今天meeting蘋果13` → `我今天 meeting 蘋果 13。`（6 條規則）
- 🔄 **引擎自動降級**（P3）— sherpa 失敗自動切 whisper，UI toast 通知
- 🔒 **完全離線** — 模型下載後就無需網路

## 📦 安裝

### 從 installer 安裝（推薦，v0.1.0+）

從 [GitHub Releases](https://github.com/galaxy-luke/speak2t/releases) 下載 `Speak2T-Setup-0.1.0.exe`，雙擊安裝。

### 從 source 跑

```powershell
git clone https://github.com/galaxy-luke/speak2t.git
cd speak2t
npm install --legacy-peer-deps
npm run dev
```

首次啟動後，從系統匣打開「設定」視窗 → 切到 ASR tab → 點「下載」按鈕即可下載模型（無需再開 terminal）。

模型也可用 CLI 下載：

```powershell
npm run download-model                    # 互動選單
npm run download-model sherpa-zh-en        # 直接指定（預設引擎）
npm run download-model whisper-small       # 切到 Whisper 引擎
```

模型放在 `%APPDATA%\speak2t\models\`，不進 git。

### macOS

見 [`docs/MACOS-BUILD.md`](./docs/MACOS-BUILD.md)（需要 Mac 環境 build DMG）。

## 🚀 開發

需求：Node.js 20+ LTS（已驗 24.7）、npm 10+。

```powershell
npm install --legacy-peer-deps
npm run dev         # 開 Electron 視窗 + Vite HMR
npm run typecheck   # tsc 全綠
npm run lint
npm run build       # 產出 dist/（可手動跑）
```

## ⚙️ 設定

從系統匣圖示 → 右鍵選單 →「開啟 Speak2T」可開啟設定視窗（4 個 tab）：

| Tab | 內容 |
|-----|------|
| **一般** | 熱鍵、錄音模式、注入方式、指示器位置、開機自動啟動、**自動標點修正**、**自動引擎降級** |
| **ASR** | 引擎選擇、模型 preset、模型下載管理（進度條 + 取消）、自訂路徑、ASR 測試（含 postprocess 對比） |
| **麥克風** | 輸入裝置選擇（自動偵測 devicechange） |
| **進階** | 應用程式資訊、**後處理規則預覽**、設定重置 |

按「儲存」才寫入設定檔；按「取消」還原原值。

## ✨ 標點後處理（P3 特色）

套用 6 條規則（中英/中數空格、句尾句號、逗號統一、空白折疊、trim）：

| 範例 | 修正後 |
|------|--------|
| `我今天meeting蘋果13` | `我今天 meeting 蘋果 13。` |
| `apple的很好吃` | `apple 的很好吃。` |
| `今天,明天都好` | `今天，明天都好。` |
| `今天天氣很好`（無句尾標點） | `今天天氣很好。` |

可從「一般」tab 關閉自動修正。

## ⌨️ 預設快捷鍵

- `Ctrl+Shift+Space` — Toggle 開始 / 停止錄音

可在設定頁改成自己習慣的組合（純顯示欄位，目前需手動編輯 `settings.json`；PTT 模式留 P1+1 native hook）。

## 📋 規劃書

完整設計請見 [`SPEC.md`](./SPEC.md)。  
P1 / P2 變更見 [`CHANGELOG.md`](./CHANGELOG.md)。  
P1 / P2 計畫見 [`docs/plans/`](./docs/plans/)。  
開發紀律見 [`AGENTS.md`](./AGENTS.md)。

## 🤝 貢獻

歡迎 PR。請遵守 [`AGENTS.md`](./AGENTS.md) 的開發紀律。

## 📄 License

[MIT](./LICENSE)
