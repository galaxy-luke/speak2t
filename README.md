# Speak2T

> 為台灣繁體中文使用者打造的桌面語音輸入工具 — 本機處理、隱私優先。

按一下全域快捷鍵，講話，放開，文字自動寫入當前焦點視窗游標處。

## ✨ 特色

- 🎙️ **本機語音辨識** — 使用 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)，語音不外送
- 🈚 **繁中優化** — 預設 `paraformer-zh`（純繁中）/ 可切 `sherpa-onnx-streaming-zh-en`（中英混）
- ⚡ **兩種模式** — 長壓（Push-to-Talk） / 切換（Toggle），依使用情境選
- 🎯 **直接寫入焦點** — 剪貼簿 + 自動 Ctrl+V 注入，相容性最高
- 🔔 **錄音指示器** — 螢幕底部浮窗，含即時音量動態
- 🪟 **系統匣常駐** — 不干擾工作、需要時隨叫隨用
- 🔒 **完全離線** — 首次下載模型後就無需網路

## 📦 安裝

> 目前還在 P0 開發階段。release 下載連結待 P4 完成後提供。

從 source 自己 build：

```powershell
git clone https://github.com/YOUR_USERNAME/speak2t.git
cd speak2t
npm install
npm run build:win   # 產出 dist/*.exe 安裝檔
```

## 🚀 開發

需求：Node.js 20+ LTS（已驗 24.7）、npm 10+。

```powershell
npm install
npm run dev         # 開 Electron 視窗 + Vite HMR
```

第一次跑會彈下載模型提示窗，預設下載 `sherpa-onnx-streaming-zh-en`（~200MB）。

## ⌨️ 預設快捷鍵

- `Ctrl+Shift+Space` — 開始 / 停止錄音（模式可在設定切換）

可在設定頁改成自己習慣的組合。

## 📋 規劃書

完整設計請見 [`SPEC.md`](./SPEC.md)。

## 🤝 貢獻

歡迎 PR。請遵守 [`AGENTS.md`](./AGENTS.md) 的開發紀律。

## 📄 License

[MIT](./LICENSE)
