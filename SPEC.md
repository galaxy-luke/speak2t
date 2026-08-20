# Speak2T — 語音輸入轉文字工具 規劃書

> **狀態**: v1.4 ✅（P0-P3 全部完成；後處理器 + 引擎降級上線）
> **建立日期**: 2026-08-19
> **最後更新**: 2026-08-20
> **目標平台**: Windows 11 優先（後續 macOS）
> **語言焦點**: 繁體中文（zh-TW）為主、英文混講為輔
> **工作目錄**: `D:\My_Projects\Speak2T`

---

## 1. 專案目標

打造一個 **桌面常駐的語音輸入工具**，讓繁體中文使用者能：

- 用 **語音** 取代打字，直接把說話內容寫到任何應用程式的當前焦點欄位
- 用 **全域快捷鍵** 或 **長壓** 觸發，不需切換視窗
- 看到 **即時錄音指示器 + 音量動態效果**，確認真的有在收音
- 縮到 **系統匣** 不佔空間，需要時隨叫隨用
- 一切都 **在本機處理**，語音不外送（隱私優先）

### 1.1 非目標（Out of Scope）

- ❌ 不做翻譯功能（純轉文字）
- ❌ 不做雲端 API 轉寫（OpenAI Whisper API 之類）
- ❌ 不做命令詞觸發（"打開瀏覽器"那種）
- ❌ 不做即時對話（每段獨立輸入）
- ❌ 不做 mobile 版本
- ❌ 不做多人協作 / 帳號系統

---

## 2. 使用者故事

| # | 角色 | 情境 | 預期 |
|---|------|------|------|
| U1 | 寫稿者 | 在 Notion 編輯區，按住 `Ctrl+Shift+Space` 開始錄音，放開後文字自動插入游標處 | 完整段落正確插入游標位置 |
| U2 | 程式設計師 | 在 VSCode 註解欄，按 `Ctrl+Shift+Space` 切換模式錄音，再按一次結束 | 程式碼註解直接出現，無需切換視窗 |
| U3 | 客服 | 在瀏覽器輸入框，快速講完客戶問題 | 繁中標點自動加上，無錯字 |
| U4 | 會議中 | 開著 PowerPoint 按 hotkey 錄自己的想法到備註欄 | 不干擾會議，最小化視窗 |
| U5 | 任何使用者 | 不想被快捷鍵干擾，暫時關掉功能 | 從系統匣暫停 / 恢復 |

---

## 3. 核心功能需求

### 3.1 錄音觸發（兩種模式，由設定切換）

| 模式 | 觸發 | 結束 | 適合場景 |
|------|------|------|---------|
| **A. 長壓（Push-to-Talk）** | 按住熱鍵不放 | 放開熱鍵 | 短指令、避免誤觸 |
| **B. 切換（Toggle）** | 按一下熱鍵開始 | 再按一下結束 | 長段落、會議記錄 |

⚠️ **D-1（待決策）**: 預設模式是哪個？建議 A（更不容易誤觸）

### 3.2 文字注入

- **注入目標**: 當前焦點視窗 / 當前游標位置
- **觸發時機**: ASR 辨識完成後立即注入
- **注入方式**: 見 §4.3 技術選型
- **自動標點**: 整合模型原生標點（paraformer-zh / ywh-whisper 都支援）

### 3.3 指示器視窗（錄音狀態浮窗）

- 位置: 螢幕底部中央（預設）or 跟著鼠標
- 樣式: 半透明圓角視窗，always-on-top
- 內容:
  - 麥克風 icon（靜音 / 收音中兩狀態）
  - 即時音量條 / 波形動態
  - 錄音時長（可選）
- 結束後淡出 300ms 消失

⚠️ **D-2（待決策）**: 位置策略 = 固定 / 跟鼠標？

### 3.4 系統匣（System Tray）

- 圖示: 待機灰 / 收音中紅
- 右鍵選單: 設定、開啟主視窗、暫停、結束
- 左鍵: 開啟主視窗
- 關閉主視窗 ≠ 結束程式（縮到 tray）

### 3.5 全域快捷鍵

- **預設**: `Ctrl+Shift+Space`（容易按、不衝突）
- **自訂**: 設定 UI 可改（要避開系統熱鍵）
- **範圍**: 系統全域（即使 Speak2T 沒 focus）

### 3.6 設定（主視窗）

- 熱鍵自訂
- 模式切換（長壓 / 切換）
- ASR 引擎選擇
- 模型選擇
- 麥克風裝置選擇
- 注入方式
- 指示器位置 / 大小
- 開機自動啟動（可選）

---

## 4. 技術選型

### 4.1 桌面框架

✅ **Electron**（確定）

- 理由: 跨平台、UI 開發快、tray + globalShortcut + webContents 開錄音 + BrowserWindow alwaysOnTop 都內建
- TS + React + Vite（renderer 端）
- electron-builder 打包

⚠️ **D-3（待決策）**: 打包工具 = electron-builder / electron-forge？建議 **electron-builder**（成熟、文件多）

### 4.2 ASR（自動語音辨識）引擎

候選比較：

| 引擎 | 語言 | 速度（CPU） | 模型大小 | 繁中品質 | 整合難度 |
|------|------|------------|---------|---------|---------|
| **whisper.cpp** | 多 | 中 | 75MB–1.5GB | 中（需挑模型） | 中（CLI / Node addon） |
| **faster-whisper** | 多 | 快 | 同上 | 中 | 中（Python server） |
| **sherpa-onnx** | 多 + 中文特化 | **最快** | 40–300MB | **高**（paraformer-zh） | 中（stream API） |
| **whisper-node** | 多 | 中 | 同 whisper | 中 | 簡（純 JS） |

**建議**: **sherpa-onnx**（k2-fsa 出品）

- 理由:
  - `paraformer-zh` 對中文**極度優化**（阿里達摩院開源）
  - 支援 streaming（邊說邊辨識，延遲低）
  - ONNX Runtime CPU 跑很順，**不用 GPU** 也能即時
  - 有預先編譯 Node.js binding（`sherpa-onnx-node`）
  - 模型小（paraformer-zh-small 約 40MB）

備案: **whisper.cpp + ywh-whisper**（如果想支援多語言混講 / 英文需求高）

⚠️ **D-4（待決策）**: ASR 引擎 = sherpa-onnx / whisper.cpp / faster-whisper？

⚠️ **D-5（待決策）**: 預設模型 = ?
- `sherpa-onnx` → `paraformer-zh-small`（40MB，純中文）或 `sherpa-onnx-streaming-zh-en`（中英混）
- `whisper.cpp` → `ggml-medium.bin`（1.5GB，最準）或 `ggml-small.bin`（460MB）

### 4.3 文字注入（最關鍵也最 tricky 的部分）

候選方案：

| 方案 | 跨平台 | 穩定度 | 瀏覽器相容 | 程式碼 |
|------|--------|--------|----------|--------|
| **A. 剪貼簿注入** | ✅ | 高 | ✅ | `clipboard.writeText` → `Ctrl+V` |
| **B. 模擬按鍵**（nut-tree） | ✅ | 中 | ⚠️ 很多瀏覽器擋 | 需 keystroke-by-keystroke |
| **C. 原生 SendInput** | ❌ Win only | 高 | ✅ | Windows API |

**建議**: **A 剪貼簿注入**（首選）+ **B 模擬按鍵**（fallback）

理由:
- 剪貼簿 + 自動 paste **最快、最穩**、跨平台
- 但要注意:
  - 注入前**備份原剪貼簿**，注入後**還原**（避免覆蓋使用者剪的東西）
  - 模擬 `Ctrl+V` 用 `nut-js` 或系統級 API
  - 高頻注入要節流（避免連按 Ctrl+V 影響其他 app）

⚠️ **D-6（待決策）**: 注入方式 = 剪貼簿 + 自動 paste / 純模擬按鍵 / 兩者切換？

### 4.4 音訊擷取

- 渲染進程用 `navigator.mediaDevices.getUserMedia`（最標準）
- 透過 IPC 傳 PCM 到主進程
- 主進程餵給 ASR worker
- 麥克風選擇透過 Electron `desktopCapturer` 取得裝置列表

### 4.5 全域快捷鍵

- Electron `globalShortcut.register`（內建）
- 注意: 已被別的 app 佔用要提示 user

### 4.6 狀態管理

- 主進程單例 `AppState` + 簡單 EventEmitter
- 不引進 Redux/Zustand 等（避免過度設計）

---

## 5. 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Tray    │  │ Hotkey   │  │AudioPipe │  │  ASR     │   │
│  │ Manager  │  │ Manager  │  │ (PCM)    │  │ Worker   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │         │
│       └──────────────┴──────┬───────┴──────────────┘         │
│                             ▼                                │
│                    ┌─────────────────┐                       │
│                    │   AppState      │  ◄── 模式 / 熱鍵 / 設定│
│                    │   (EventEmitter)│                       │
│                    └────────┬────────┘                       │
│                             │ IPC                            │
└─────────────────────────────┼───────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌──────────────────┐   ┌──────────────┐
│  Indicator    │    │   Settings       │   │  Text        │
│  BrowserWindow│    │   BrowserWindow  │   │  Injector    │
│  (overlay)    │    │   (main UI)      │   │  (child or   │
│  alwaysOnTop  │    │                  │   │   in-main)   │
└───────────────┘    └──────────────────┘   └──────────────┘
```

### 5.1 模組切分（per-function，符合 user 偏好）

```
speak2t/
├── src/
│   ├── main/                       # Electron main 進程
│   │   ├── index.ts                # 入口（極簡，只做 wiring）
│   │   ├── app-state.ts            # 全域狀態
│   │   ├── tray/
│   │   │   └── index.ts            # 系統匣
│   ├── functions/                  # per-function 垂直切分
│   │   ├── hotkey/
│   │   │   ├── manager.ts          # globalShortcut 包裝
│   │   │   ├── recorder.ts         # 長壓 / 切換狀態機
│   │   │   └── types.ts
│   │   ├── audio/
│   │   │   ├── capture.ts          # getUserMedia + IPC
│   │   │   ├── devices.ts          # 麥克風列舉
│   │   │   └── level-meter.ts      # 即時音量分析
│   │   ├── asr/
│   │   │   ├── engine.ts           # ASR 抽象介面
│   │   │   ├── sherpa-onnx.ts      # sherpa-onnx 實作
│   │   │   ├── whisper-cpp.ts      # whisper.cpp 實作（備案）
│   │   │   └── model-manager.ts    # 模型下載 / 切換
│   │   ├── injector/
│   │   │   ├── clipboard.ts        # 剪貼簿注入
│   │   │   ├── keystroke.ts        # 模擬按鍵
│   │   │   └── strategy.ts         # 注入策略選擇
│   │   ├── indicator/
│   │   │   ├── window.ts           # 浮窗控制
│   │   │   ├── position.ts         # 位置策略
│   │   │   └── preload.ts          # IPC 橋接
│   │   └── settings/
│   │       ├── store.ts            # 設定持久化
│   │       └── schema.ts           # 設定 schema
│   ├── renderer/                   # React UI
│   │   ├── settings/               # 設定頁
│   │   └── indicator/              # 浮窗 UI（音量動畫）
│   ├── shared/                     # 共用型別 / IPC contract
│   │   ├── ipc-channels.ts
│   │   ├── types.ts
│   │   └── constants.ts
│   └── preload/                    # preload scripts
│       ├── settings.ts
│       └── indicator.ts
├── assets/                         # 圖示 / 靜態資源
├── models/                         # ASR 模型（gitignore）
├── docs/
│   ├── SPEC.md                     # 本文件
│   ├── ARCHITECTURE.md             # 架構細節
│   ├── DECISIONS.md                # ADR 紀錄
│   └── TROUBLESHOOTING.md
├── tests/                          # 單元 / 整合測試
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
└── README.md
```

### 5.2 資料流（一次長壓操作）

```
[user 按住熱鍵]
   ↓ globalShortcut 觸發
[hotkey/recorder 進入 RECORDING 狀態]
   ↓ IPC 通知 renderer 顯示 indicator
[audio/capture 開始 getUserMedia → MediaRecorder]
   ↓ stream chunks
[audio/level-meter 計算即時音量 → IPC 給 indicator UI]
   ↓ 同時
[ASR worker 接收 PCM → streaming recognition]
   ↓ partial results
[user 放開熱鍵]
   ↓ recorder 進入 PROCESSING
[停止 capture, 取最終 ASR 結果]
   ↓
[injector 選擇策略 → 注入到焦點視窗]
   ↓
[indicator 淡出]
   ↓
[recorder 回到 IDLE]
```

---

## 6. 開發階段計畫

> **進度快照（2026-08-20）**：P0 ✅ P1 ✅ P2 ✅ P3 ✅ 全部完成（HEAD = `fe638bf`，領先 origin/main 16 commit）。
> 詳細 P3 變更見 [`CHANGELOG.md`](./CHANGELOG.md) 與 [`docs/plans/P3-plan.md`](./docs/plans/P3-plan.md)。

### P0 — 雛形（核心閉環，3–5 天）

- [x] Electron 專案骨架 + TS + Vite + React
- [x] 主進程：tray + 單一熱鍵（先 hard-code）
- [x] 渲染進程：getUserMedia 錄音 → 寫成 WAV
- [x] 整合 sherpa-onnx 預備（套件驗證 OK，實際整合在 P1）
- [x] 簡單的"按下按鍵、輸出文字到剪貼簿"流程
- [x] 沒有 UI 美化，只求能跑

**驗收**: 按熱鍵 → 講話 → 放開 → 文字在剪貼簿可貼上 ✅

### P1 — 基礎 UX（3–5 天，實際 7 天含 6.5 插隊）

- [x] 全域快捷鍵（globalShortcut） ✅
- [x] Toggle 模式（預設），PTT 留 P1+1（需 uiohook-napi native key hook） ✅
- [x] 指示器浮窗（alwaysOnTop、frameless、音量條、partial 文字） ✅
- [x] 文字注入：剪貼簿 + 自動 paste（兩種模式可選，設定可切） ✅
- [x] 設定檔持久化（JSON in userData） ✅
- [x] 系統匣 icon 切換狀態（P1 沿用 P0 tray） ✅
- [x] 雙引擎：sherpa-onnx-streaming（預設）+ whisper.cpp（備援） ✅
- [x] 模型下載 script（`npm run download-model` 互動式 CLI） ✅
- [x] **麥克風設備選擇 UI（user 插隊，enumerateDevices + devicechange）** ✅

**驗收**: Toggle 模式能用，浮窗顯示狀態，文字直接注入到 Notion / VSCode ✅
（ASR 真的跑需要 user 跑 `npm run download-model sherpa-zh-en` 拿模型）

### P2 — 設定 UI + 模型管理 + 開機啟動（3–4 天）

- [x] 設定主視窗（navbar + 4 tab：一般/ASR/麥克風/進階）✅
- [x] 引擎/preset 切換 + 自動重載 ASR ✅
- [x] 模型下載 UI（進度條 + 取消 + 完成自動 reload）✅
- [x] 麥克風裝置列舉 + 選擇（從 P1 搬來精修）✅
- [x] 注入方式 / 指示器位置 / 開機啟動 toggle ✅
- [x] 設定檔重置（進階 tab）✅

**驗收**: 全部功能可從 UI 設定，不需改 config ✅

### P3 — 繁中優化（2–3 天）

- [x] 標點自動修正（6 條規則 + 30 unit test）✅
- [x] 引擎自動降級（sherpa→whisper fallback）✅
- [x] 設定 toggle 控制後處理 + 降級 ✅
- [x] 後處理預覽 / 對比 UI（AdvancedTab + AsrTester）✅
- [ ] ~~中英混用識別測試~~（驗收項不計入 feature）
- [ ] ~~自訂詞彙表~~（O-2 已砍，user 確認不做）

**驗收**: 講一段 30 秒的繁中段落，標點 / 分段 / 換行 90% 正確 ✅

### P4 — 打包 + 自動更新 + 跨平台（3–5 天）

- [ ] electron-builder 打包 Windows installer / portable
- [ ] 開機自動啟動（`app.setLoginItemSettings`）
- [ ] 自動更新（`electron-updater` 或省）
- [ ] macOS build 測試（輔助使用權限、麥克風權限）

**驗收**: 從官網下載安裝檔，雙擊安裝，開機自動啟動

### P5（可選）— 進階

- 多段錄音（保留 N 段歷史）
- 匯出歷史（純文字 / SRT）
- 客製化指示器主題
- CLI 模式（無 GUI，給進階用戶）
- Plugin 系統

---

## 7. 決策彙整 ✅（D-1 ~ D-10 全部已確認）

| ID | 決策 | 結果 | 備註 |
|----|------|------|------|
| **D-1** | 預設錄音模式 | ✅ **兩種都給，user 設定切換** | 預設長壓 Push-to-Talk |
| **D-2** | 指示器位置 | ✅ **兩種都給，user 設定切換** | 預設螢幕底部中央 |
| **D-3** | 打包工具 | ✅ **electron-builder** | NSIS 安裝檔，可指定安裝路徑 |
| **D-4** | ASR 引擎 | ✅ **sherpa-onnx-streaming（預設）+ whisper.cpp（備援）**（v1.2 修訂）| 雙引擎架構：低延遲預設 + 高品質備援，設定可切換 |
| **D-5** | 預設模型 | ✅ **sherpa-onnx-streaming-zh-en（預設）+ Whisper-small-zh_tw（備援）**（v1.2 修訂）| 預設取延遲優勢；備援取台灣腔調品質 |
| **D-6** | 注入方式 | ✅ **兩種都給，user 設定切換** | 預設剪貼簿 + 自動 Ctrl+V；可切換純模擬按鍵 |
| **D-7** | 開機自動啟動 | ✅ **設定頁 toggle，預設 off**（v1.3 簡化：從「首次啟動彈窗」改為「設定頁可開」）| 不預設啟動，由 user 決定 |
| **D-8** | 開源授權 | ✅ **MIT** | 最寬鬆、商業可用 |
| **D-9** | 模型存放位置 | ✅ **兩者都支援，user 可選** | 預設 `%APPDATA%\speak2t\models\` |
| **D-10** | 首次啟動下載 | ✅ **預設手動下載，可改自動** | 透明優先 |

### 7.1 決策變動影響的設計項目

- D-1（兩種模式）：UI 需提供「模式切換」設定項；hotkey 狀態機需支援 PTT / Toggle 兩種
- D-2（兩種位置）：indicator window manager 需支援 `bottom-center` / `follow-cursor` 兩策略
- **D-4 + D-5（v1.2 修訂 — 雙引擎）**：
  - 預設 `sherpa-onnx-streaming`：低延遲（100-300ms）、無幻覺、輕量，邊講邊出字
  - 備援 `whisper.cpp + Whisper-small-zh_tw`：台灣腔調品質高、繁中直出、中英混優
  - 設定頁可切換（讓使用者根據自己的筆電性能 + 語音場景選）
  - 抽象介面 `ASR engine` 同時支援兩種實作
  - 整合時程：P1 先做 sherpa-onnx-streaming 主線，視台灣腔調表現再決定是否加 whisper.cpp
- D-6（兩種注入）：injector 模組需設計策略切換器；剪貼簿注入要實作備份+還原
- **D-7（v1.3 簡化）**：原決策「首次啟動彈小窗詢問」改為「設定頁 toggle，預設 off」。理由：實作 modal 成本高、user 設定介面已經夠直覺、避免首次啟動體驗被中斷。實作位置：P2 Stage 3（`src/functions/autostart/manager.ts` + GeneralTab toggle）
- D-9（兩種路徑）：模型路徑存到 settings，可從設定頁改
- D-10（手動/自動）：首次啟動流程：偵測模型 → 缺模型時 ASR tab 顯示「下載」按鈕（直接 UI 操作，無 modal）

---

## 8. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| 麥克風權限被擋 | 中 | 功能失效 | 啟動時引導開權限 |
| ASR 引擎安裝失敗 | 中 | 核心功能掛 | 提供 fallback 引擎 |
| 文字注入被瀏覽器擋 | 中 | 體驗打折 | 剪貼簿策略 + 提示 |
| 音訊裝置衝突（Skype 等） | 高 | 錄不到聲音 | 提示關閉佔用 app |
| 模型下載慢 / 失敗 | 中 | 首次體驗差 | 進度條 + 重試 + 鏡像 |
| 繁中標點 / 分段差 | 中 | 需後處理 | 規則引擎 + 自訂詞 |
| 熱鍵衝突 | 中 | 功能失效 | 設定時檢查 + 提示 |
| macOS 輔助使用權限 | 中 | 注入失敗 | 引導開權限 |

---

## 9. 技術棧總結

| 層 | 選擇 | 版本 |
|----|------|------|
| Runtime | Node.js | 20 LTS |
| Framework | Electron | 30+ |
| 語言 | TypeScript | 5.x |
| UI | React | 18 |
| 建置 | Vite | 5 |
| 打包 | electron-builder | 24 |
| ASR | sherpa-onnx（建議） | latest |
| 注入 | nut-tree/nut-js | latest |
| 測試 | Vitest + Playwright | latest |
| Lint | ESLint + Prettier | latest |
| 程式碼風格 | TypeScript strict + Prettier | — |

---

## 10. 開放問題答案 ✅（O-1 ~ O-4 全部已確認）

| ID | 問題 | 答案 | 備註 |
|----|------|------|------|
| **O-1** | 公開發布 | ✅ **公開到 GitHub** | 需 README、CHANGELOG、issue template、CI（之後規劃） |
| **O-2** | 自訂詞彙表 | ✅ **不做** | 砍掉此功能，開發最簡，靠 ASR 內建能力 |
| **O-3** | 雲端 fallback | ✅ **完全不要** | 完全本機、不連任何雲端，隱私最優 |
| **O-4** | 多段錄音歷史 | ✅ **P5 可選功能** | 預設不做，UI 留 hook 以後接 |

### 10.1 開放問題決策的設計影響

- **O-1 公開 GitHub**：需補 README.md / CHANGELOG.md / LICENSE（MIT）/ 必要的 GitHub Actions
- **O-2 不做詞彙表**：
  - ASR 引擎抽象介面可簡化（無 hot-word injection）
  - 設定 UI 拿掉「詞彙表」分頁
  - 階段計畫 P3 縮短
- **O-3 完全本機**：
  - 不需要任何網路呼叫（除了首次下載模型）
  - 隱私白皮書頁面可以放在 README 強調
  - 設定中拿掉任何雲端相關選項
- **O-4 P5 歷史**：歷史相關代碼先不做，但介面設計保留擴展點（recorder 結果可順便 push 到 history queue）

---

## 11. 下一步

✅ **所有決策確認完畢**（D-1 ~ D-10 + O-1 ~ O-4，共 14 題）

### 11.1 P0 實作準備清單

進入 P0 實作前需完成：
- [ ] `AGENTS.md`（給未來 AI agent 看的專案說明）
- [ ] `LICENSE`（MIT）
- [ ] `README.md`（含安裝/使用/開發說明）
- [ ] `package.json` + 基礎 Electron 骨架
- [ ] `tsconfig.json` + `vite.config.ts`
- [ ] per-function 目錄骨架（main / functions / renderer / shared）
- [ ] 一個 hello-world：熱鍵 → 顯示「收到」toast

### 11.2 P0 範圍（3-5 天）

- [ ] 主進程：tray + 單一熱鍵（先 hard-code `Ctrl+Shift+Space`）
- [ ] 渲染進程：getUserMedia 錄音 → 寫成 WAV
- [ ] 整合 sherpa-onnx-node（先做檔案式辨離線辨識）
- [ ] 簡單流程：按下熱鍵 → 講話 → 放開 → 文字到剪貼簿
- [ ] 沒有 UI 美化，只求能跑

### 11.3 規格快照（給 P0 啟動用）

```
技術棧: Node 20 / Electron 30+ / TypeScript 5 / React 18 / Vite 5
ASR (v1.2 雙引擎):
  - 預設: sherpa-onnx-streaming + sherpa-onnx-streaming-zh-en（低延遲，~200MB）
  - 備援: whisper.cpp + Whisper-small-zh_tw（台灣腔調，INT8 量化 ~460MB）
  - 設定頁可切換
注入: 剪貼簿 + 自動 Ctrl+V（P0）
打包: electron-builder（P4 階段）
模式: 長壓（預設）
位置: 螢幕底部中央（預設）
授權: MIT
發布: GitHub 公開
```

---

**版本**: v1.2 ✅
**維護者**: Luke
**最後更新**: 2026-08-19

### 變更記錄

- **v1.2** (2026-08-19) — D-4 / D-5 改為**雙引擎**架構
  - 預設 `sherpa-onnx-streaming`（拿低延遲 UX 優勢）
  - 備援 `whisper.cpp + Whisper-small-zh_tw`（拿台灣腔調品質）
  - 設定頁可切換
  - 原因：v1.1 推薦 whisper.cpp 但忽略「語音輸入工具」最關鍵的延遲指標
- **v1.1** (2026-08-19) — D-4 改 whisper.cpp、D-5 改 Whisper-small-zh_tw（基於實際 npm registry 與繁中品質評估）
  - 原 D-4 = sherpa-onnx：因 `@nut-tree/nut-js` npm 套件 404 撤下，重新評估後 Whisper 對台灣繁中更優
  - 影響：P1 實作時改用 whisper.cpp binding（`nodejs-whisper` 或 faster-whisper）
- **v1.0** (2026-08-19) — D-1 ~ D-10 + O-1 ~ O-4 全部決策初版

---

**版本**: v0.1
**維護者**: Luke
**最後更新**: 2026-08-19
