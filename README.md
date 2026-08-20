# Speak2T

> 為台灣繁體中文使用者打造的桌面語音輸入工具 — 本機處理、隱私優先。

按一下全域快捷鍵，講話，再按一下，文字自動寫入當前焦點視窗游標處。

## 📊 目前進度

**P1 完成** ✅ — 語音辨識 + 文字注入完整閉環  
**P2 規劃中** — 獨立設定 UI、開機啟動、electron-builder 打包

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
- 🔒 **完全離線** — 模型下載後就無需網路

## 📦 安裝

> P4 打包階段完成後會提供 release installer。目前從 source 跑。

從 source：

```powershell
git clone https://github.com/galaxy-luke/speak2t.git
cd speak2t
npm install --legacy-peer-deps
npm run download-model sherpa-zh-en   # 340 MB 一次性下載
npm run dev
```

## 🚀 開發

需求：Node.js 20+ LTS（已驗 24.7）、npm 10+。

```powershell
npm install --legacy-peer-deps
npm run dev         # 開 Electron 視窗 + Vite HMR
npm run typecheck   # tsc 全綠
npm run lint
```

**模型下載**（一次性）：

```powershell
npm run download-model                    # 互動選單
npm run download-model sherpa-zh-en        # 直接指定（預設引擎）
npm run download-model whisper-small       # 切到 Whisper 引擎
```

模型放在 `%APPDATA%\speak2t\models\`，不進 git。

## ⌨️ 預設快捷鍵

- `Ctrl+Shift+Space` — Toggle 開始 / 停止錄音

可在設定頁改成自己習慣的組合（PTT 模式留 P1+1 native hook）。

## 📋 規劃書

完整設計請見 [`SPEC.md`](./SPEC.md)。  
P1 階段驗收清單見 [`CHANGELOG.md`](./CHANGELOG.md)。  
開發紀律見 [`AGENTS.md`](./AGENTS.md)。

## 🤝 貢獻

歡迎 PR。請遵守 [`AGENTS.md`](./AGENTS.md) 的開發紀律。

## 📄 License

[MIT](./LICENSE)
