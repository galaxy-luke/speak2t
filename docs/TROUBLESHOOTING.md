# Speak2T 故障排除

> 待 P1 階段累積實際問題後撰寫。

## 常見問題

### Q1: 開發模式下 Electron 視窗打不開

檢查：
1. Vite dev server 是否在 `http://localhost:5173` 起來
2. `ELECTRON_RENDERER_URL` 環境變數是否有正確傳給 Electron
3. 主控台是否有 TypeScript 編譯錯誤（main / preload 必須編譯成功）

### Q2: 全域熱鍵沒作用

可能原因：
- 已被其他 app 佔用（如 Spotify、Discord 的全域熱鍵）
- 在某些 focus 模式下 Electron 無法接收
- Windows 需要 app 在前景或最小化才能註冊

### Q3: 麥克風權限被擋

需要到 Windows 設定 → 隱私權 → 麥克風，允許 Electron 存取。

---

更多問題待補。
