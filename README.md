# 聲打 / Speak2T

> Speak2T 為台灣繁中使用者打造的桌面語音輸入工具。
> 按下全域快捷鍵 → 講話 → 文字自動注入當前焦點視窗。
> 本機 ASR（sherpa-onnx 雙引擎），模型下載後無需網路。
>
> A free, open-source desktop voice-to-text tool for Traditional Chinese users in Taiwan.

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

## 💖 Donate

如果 Speak2T 對你有幫助，歡迎贊助支持開發 ☕

### 💳 一般付款

- **KO-FI**：[ko-fi.com/otter2studio](https://ko-fi.com/otter2studio)
- **街口支付**：[轉帳連結](https://service.jkopay.com/r/transfer?j=Transfer:900310585&amount=50)
  （打開街口 App、預設 50 元、可自訂金額；對方 ID: `900310585`）

### 🪙 加密貨幣

| 幣種 | 鏈 | Address | 備註 |
|------|-----|---------|------|
| BTC | Bitcoin (Taproot) | `bc1pel9nq7qfw0wfcr77ay6gjrtnr0xh478jn0jgz5uj4cqp5jc866ls9099eq` | Taproot 手續費最低、隱私最好 |
| ETH | EVM 通用 | `0x124c75b95c21af6d4db8bd49be9bdd6b6674bf6b` | 同 address 收 USDC / USDT-ERC20 / ENA / BNB / MATIC / AVAX |
| SOL | Solana | `EGf2jA4HoMmGhbUT3omhokpqKasiMTtzemSwQM5bNpF1` | base58 |

> ⚠️ 鏈上交易不可逆，發送前務必確認鏈別 + address 頭尾 6 碼。

---

## 📋 商業模式 & 已知限制

| 項目 | 狀態 |
|------|------|
| 授權 | [MIT](./LICENSE) |
| 收費方案 | ❌ 無（不收費、不賣授權、不訂閱） |
| 商業憑證 | ❌ 不買（Apple Developer ID / Windows EV / macOS notarization） |
| 廣告 / 追蹤 | ❌ 無（完全離線、隱私優先） |
| 收入來源 | 純粹 donate（見上節） |

### 為什麼不買憑證？

個人 side project，**沒有商業營收**。年費 USD 99-500 的憑證對個人開發者負擔過重。
本專案採「**開源透明 + 公開 audit**」原則 — 任何人都可 review source code，提供的安全保證
比 code signing 更強（code signing 只保證「這個 binary 沒被竄改」，不保證「作者沒寫惡意邏輯」）。

### ⚠️ 首次安裝警告（預期內現象）

由於沒買 code signing 憑證，安裝時 OS 會顯示「未識別的發布者」警告。
**這不是病毒 / 惡意軟體**，是「沒買 EV 憑證」的預期成本。

**Windows SmartScreen**：

> "Windows protected your PC" / SmartScreen prevented an unrecognized app from starting

**繞過**：點 "More info" → "Run anyway"。隨下載次數累積，警告強度會逐漸降低。

**macOS Gatekeeper**：

> "Speak2T cannot be opened because it is from an unidentified developer"

**繞過**：
- **GUI**：系統設定 → 隱私與安全性 → 往下捲 → 看到 Speak2T 警告 → "Open Anyway"
- **terminal**：`xattr -dr com.apple.quarantine /Applications/Speak2T.app`

### 自動更新

從 **v0.1.1** 開始，App 會透過 [electron-updater](https://www.electron.build/auto-update)
自動從 GitHub Releases 拉新版。**v0.1.0 不會自動檢查更新**（首次發布，沒有 newer version）。

## 🤝 貢獻

歡迎 PR。請遵守 [`AGENTS.md`](./AGENTS.md) 的開發紀律。

## 📄 License

[MIT](./LICENSE)
