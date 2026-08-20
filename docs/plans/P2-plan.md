# Speak2T P2 Plan — 可用性提升（設定 UI + 自動模型下載 + 開機啟動）

> **狀態**: 草稿 v0.1 — 等 user GO 才動工
> **日期**: 2026-08-20
> **範圍**: P1 完成後的下一階段，3 個 stage、約 3 個工作天
> **源頭決策**: user 2026-08-20 選「可用性提升（推薦）」＝ A+B+C 全部

---

## 1. 目標

把 P1 留下的「寫程式才能設定」升級成「UI 直接設定」，同時補齊首次使用的最後一塊拼圖（自動下載模型 + 開機自動啟動）。

### 1.1 P1 留下的痛點

| 痛點 | P1 狀態 | P2 解法 |
|------|---------|---------|
| 熱鍵/模式/引擎/麥克風全寫死 | 唯一可改 = 編輯 `%APPDATA%\speak2t\settings.json` | **設定主視窗** 全部可改 |
| 麥克風選擇在 SettingsApp 沒樣式化 | 跟其他設定混一頁 | **麥克風 tab** 集中 |
| 首次下載要關 app + 開 terminal | 唯一路徑 = `npm run download-model` | **UI 一鍵下載 + 進度條** |
| 開機要手動啟動 | 沒做 | **設定勾選自動啟動** |

### 1.2 非目標（Out of Scope）

明確不做（避免 scope 漂移）：
- ❌ PTT 模式（需 uiohook-napi native hook，留 P1+1）
- ❌ 升級 `@vitejs/plugin-react` v5（留 P2 之後的 tech debt）
- ❌ 標點自動修正（P3）
- ❌ 多段錄音歷史（P5）
- ❌ macOS 專屬功能（目前 Windows 11 優先）
- ❌ electron-builder 打包（P4）
- ❌ 自動更新（P4）
- ❌ 雲端 fallback（O-3 明確不要）

---

## 2. 範圍（user 選 A+B+C）

| Stage | 名稱 | 工時 | 重要程度 |
|-------|------|------|----------|
| **1** | 獨立設定主視窗（navbar + 4 tab） | 1.5 天 | 高 |
| **2** | 自動模型下載 UI | 1 天 | 高 |
| **3** | 開機自動啟動 | 0.5 天 | 中 |

---

## 3. 設計原則

### 3.1 整體策略

- **沿用現有架構**：per-function 垂直切分、IPC 契約、AppState EventEmitter
- **設定檔 = 唯一真相**：`settings.json` 還是 source of truth，UI 只是寫入器
- **重用 P1 module**：`AsrManager` / `audioIngest` / `clipboardInjector` 一行不改
- **DRY 下載邏輯**：P1 的 `scripts/download-model.mjs` 加 `--json` flag，main process 透過 child_process spawn 觸發，stdout 解析 JSON 進度事件
- **零新依賴**：用 Electron 內建 `app.setLoginItemSettings`（C 階段），不下載新 npm package

### 3.2 設定主視窗 UX 規劃

**佈局**：左側 navbar 200px + 右側內容區（沿用 800x600，必要時改 900x650）

```
┌─────────────────┬────────────────────────────────────┐
│ 🎙️ Speak2T     │                                    │
│                 │   [動態 tab 內容]                  │
│ ▸ 一般          │                                    │
│   ASR           │   寬鬆留白、清楚的 section          │
│   麥克風        │   按下「儲存」才寫 settings.json    │
│   進階          │   取消 = 還原原值（區域 state）    │
│                 │                                    │
│ ─────────────   │                                    │
│ v0.1.0          │                                    │
└─────────────────┴────────────────────────────────────┘
```

**4 個 tab**（用 `useState` 切換，不引 router）：

| Tab | 內容 | 對應 AppSettings 欄位 |
|-----|------|----------------------|
| **一般** | 熱鍵（顯示目前值 + 提示「需手動編輯 settings.json 變更」）、錄音模式、注入方式、指示器位置、開機自動啟動 | `hotkey`, `recordingMode`, `injectionMode`, `indicatorPosition`, `autoStart` |
| **ASR** | 引擎選擇、模型 preset、模型狀態（已下載？版本？）、下載/重新下載按鈕、進度條、自訂模型路徑 | `asrEngine`, `asrModelPreset`, `customModelPath` |
| **麥克風** | enumerateDevices 列表 + 標籤、選中狀態、devicechange 監聽、測試按鈕 | `audioDeviceId` |
| **進階** | debug log level（info/warn/error）、重置設定按鈕、關於（版本、license、SPEC.md 連結） | （未來擴充點） |

**狀態管理**：
- 載入時一次 `getSettings()` → 填表單 local state
- 修改欄位只更新 local state，**不**立即呼叫 `saveSettings`
- 「儲存」按鈕 = 一次寫入 + IPC 廣播 `settings:changed`
- 「取消」按鈕 = 還原 local state
- 切換 tab 不丟 local state（保留使用者編輯）

**熱鍵編輯**（user 重要決策，stage 1 內）：
- v1：純顯示，不能直接編輯（避免誤觸系統熱鍵）
- 加 hint「如需變更請編輯 settings.json，未來支援 UI 設定」
- 把 hotkey 編輯留在 P3+ 規劃

### 3.3 模型下載 UI 設計

**觸發流程**（點 ASR tab 的「下載」按鈕）：

```
[使用者按「下載 sherpa-zh-en」]
   ↓ IPC: invoke('download-model', { preset: 'sherpa-zh-en' })
[main spawn child_process: node scripts/download-model.mjs --json sherpa-zh-en]
   ↓ stdout 解析 JSON 進度事件
[broadcast: 'download:progress' → renderer]
[renderer 進度條更新]
   ↓ 完成 / 失敗
[broadcast: 'download:complete' / 'download:error']
[renderer 顯示「完成 / 失敗」toast]
   ↓ 自動 reload ASR manager
[main: asrManager.reload()]
```

**下載時的 UI 狀態**：
- 進度條：百分比 + 速度 + 已下載/總大小
- 「取消下載」按鈕（kill child process）
- 下載中按鈕 disable（避免重複觸發）
- 完成後 ASR manager 自動重載（讓模型立即可用）

**現有腳本改動**（`scripts/download-model.mjs`）：
- 加 `--json` flag：所有進度訊息改輸出 `JSON.stringify({ event, ...data })` 一行一個
- 加 `--cancel` flag（可選）：讓 main process 可以送 SIGTERM 取消
- 保留原有互動模式（無 --json 時維持現狀）

**IPC 設計**：

```typescript
// shared/ipc-channels.ts 新增
DOWNLOAD_MODEL: 'invoke:model:download',     // renderer→main
CANCEL_DOWNLOAD: 'invoke:model:cancel',      // renderer→main
LIST_MODELS: 'invoke:model:list',            // renderer→main
DOWNLOAD_PROGRESS: 'broadcast:download:progress',  // main→renderer
DOWNLOAD_COMPLETE: 'broadcast:download:complete',  // main→renderer
DOWNLOAD_ERROR: 'broadcast:download:error',  // main→renderer

// shared/types.ts 新增
interface ModelInfo {
  key: string;          // 'sherpa-zh-en' / 'whisper-small'
  name: string;
  description: string;
  installed: boolean;   // 本機路徑存在
  sizeBytes: number;    // 預期大小
  path: string;         // 預期下載路徑
}

interface DownloadProgressPayload {
  preset: string;
  phase: 'downloading' | 'extracting' | 'cleanup' | 'done';
  percent: number;      // 0~100
  speedBps: number;     // bytes/sec, 0 if not downloading
  downloaded: number;   // bytes
  total: number;        // bytes
  message?: string;     // e.g. "解壓中..."
  timestamp: number;
}
```

**安全考量**：
- child_process 固定 spawn `process.execPath` + `scripts/download-model.mjs`（**不**接受 renderer 傳任意命令）
- preset 必須在白名單內（用 `downloadModel` 內部的 `MODELS` 物件比對）
- stderr 也要轉發給 renderer（顯示錯誤訊息）
- 取消：傳 SIGTERM 給 child process，給 3 秒 grace period，否則 SIGKILL
- 同一時間只允許一個下載（避免佔滿 CPU/網路）

### 3.4 開機自動啟動設計

**Electron 內建 API**：`app.setLoginItemSettings({ openAtLogin, openAsHidden, path, args })`

**設計**：
- `settings.autoStart` 為 `true` → `app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })`
- `settings.autoStart` 為 `false` → `app.setLoginItemSettings({ openAtLogin: false })`
- `openAsHidden: true`：開機時不彈主視窗（tray 常駐）
- **首次啟動（D-7 決策）**：保留 user 決策「首次啟動彈小窗詢問」，但實作成本高（要 modal），**stage 3 改成「預設關 + 設定頁可開」**，user 自己決定

**時機**：
1. App 啟動時（`app.whenReady`）：讀 `settings.autoStart` → 套用到 OS
2. `settings:changed` event：autoStart 改變時即時套用
3. 設定頁 toggle：optimistic update（先存 settings，再套 OS）

**跨平台考量**：
- Windows：寫 registry `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`
- macOS：寫 `~/Library/LaunchAgents/com.luke.speak2t.plist`
- Linux：寫 `~/.config/autostart/speak2t.desktop`
- P2 只驗 Windows 11（user 目前環境），macOS/Linux 留 P4 處理

**D-7 決策影響**：
- v1.1 SPEC 寫「首次啟動彈小窗詢問」
- P2 簡化：開機啟動 toggle 就在「一般」tab，預設 off
- 不做「首次啟動詢問」modal（避免 P2 scope 漂移）
- 在 README / SPEC v1.2 加註：v1.1 D-7 改為「設定頁可開」

---

## 4. Stage 拆分

### Stage 1：獨立設定主視窗（1.5 天）

**目標**：把現有 `SettingsApp.tsx` 8 個 `<section>` 改成 navbar + 4 tab 結構。

**步驟**：
1. 擴大主視窗：800x600 → 900x650（`src/main/windows.ts` `createMainWindow`）
2. 拆 `SettingsApp.tsx` → 4 個 component：
   - `src/renderer/settings/SettingsApp.tsx`（頂層，navbar + 內容切換）
   - `src/renderer/settings/tabs/GeneralTab.tsx`
   - `src/renderer/settings/tabs/AsrTab.tsx`（先做框架，下載按鈕 stage 2 接）
   - `src/renderer/settings/tabs/MicTab.tsx`（從現有麥克風 section 搬）
   - `src/renderer/settings/tabs/AdvancedTab.tsx`（簡單佔位）
3. 加 navbar 樣式（`src/renderer/styles.css`）：左側 200px、垂直選單、active state 高亮
4. 引入 local state 模式（form draft）：
   - 載入 `getSettings()` → 填入 `formData` state
   - 修改只更新 `formData`
   - 「儲存」按鈕 → 呼叫 `saveSettings(formData)` → 廣播
   - 「取消」按鈕 → 還原 `formData` 回剛載入的值
   - 切 tab 不丟 draft
5. 處理 hotkey 欄位：純顯示（disabled input + 提示）
6. 處理「一般」tab 的 toggle（recordingMode / injectionMode / indicatorPosition / autoStart）：用 `<select>` 對應 enum
7. 處理 ASR engine 切換：跟 AsrManager 的 `switchEngine` 整合（呼叫 main process API，main 內部做 dispose + reinit）
8. **驗證**：切 tab、改值、儲存 → 關 app → 重開 → 設定值正確

**新增 API**（`src/shared/api.ts` + `src/preload/index.ts` + `src/main/index.ts`）：

```typescript
// 不需要新 IPC，AsrEngine 切換在 stage 2 一併做
// settings 變更時 main 已經會 emit settings:changed
```

**Files touched**：
- `src/renderer/settings/SettingsApp.tsx`（重構）
- `src/renderer/settings/tabs/`（新增 4 個檔案）
- `src/renderer/styles.css`（navbar + form styles）
- `src/main/windows.ts`（視窗大小）

### Stage 2：自動模型下載 UI（1 天）

**目標**：UI 一鍵下載 + 進度條 + 自動重載 ASR。

**步驟**：
1. **重構 `scripts/download-model.mjs`**：
   - 加 `--json` flag（互動 → 純 JSON 事件輸出）
   - 加 `--cancel-safe` flag（捕獲 SIGTERM 優雅退出）
   - 保留原互動模式（無 flag）
2. **新增 `src/functions/model/downloader.ts`**（main 端 manager）：
   - `class ModelDownloader extends EventEmitter`
   - `listModels(): ModelInfo[]`：讀 MODELS dict + 檢查本機路徑
   - `startDownload(presetKey): Promise<void>`：spawn child_process + 解析 stdout JSON
   - `cancelDownload()`：kill child process
   - 事件：`progress`, `complete`, `error`
3. **IPC handlers**（`src/main/index.ts`）：
   - `IPC.LIST_MODELS` → `downloader.listModels()`
   - `IPC.DOWNLOAD_MODEL` → `downloader.startDownload(preset)`（async，return 立即）
   - `IPC.CANCEL_DOWNLOAD` → `downloader.cancelDownload()`
   - main 訂閱 `downloader` events → 廣播到所有 renderer
4. **整合 AsrManager 重載**（`src/main/index.ts`）：
   - 訂閱 `downloader.on('complete')` → `asrManager?.reload()`（dispose 舊的、用新模型 init）
5. **renderer 端**：
   - `ASRTab` 加模型狀態清單（已下載打勾、未下載顯示下載按鈕）
   - 下載按鈕點擊 → 呼叫 `downloadModel(preset)`
   - 訂閱 `downloadProgress` / `downloadComplete` / `downloadError` → 更新進度條 + toast
   - 進度條 UI（用 CSS 簡單實作，無需新 component library）
6. **驗證**：
   - 點下載 → 進度條更新 → 進度到 100% → toast「完成」→ ASR tab 模型狀態變已下載
   - 點取消 → child 終止 → toast「已取消」
   - 故意觸發失敗（拔網線）→ toast「失敗」

**Files touched**：
- `scripts/download-model.mjs`（加 --json / --cancel-safe）
- `src/functions/model/downloader.ts`（new）
- `src/main/index.ts`（IPC handlers + event wiring）
- `src/shared/ipc-channels.ts`（6 新 channel）
- `src/shared/types.ts`（ModelInfo + DownloadProgressPayload）
- `src/shared/api.ts`（新 method 5 個）
- `src/preload/index.ts`（新 binding 5 個）
- `src/renderer/settings/tabs/AsrTab.tsx`（下載 UI）
- `src/renderer/styles.css`（進度條樣式）

### Stage 3：開機自動啟動（0.5 天）

**目標**：設定頁 toggle 自動啟動，OS registry 同步。

**步驟**：
1. **新增 `src/functions/autostart/manager.ts`**（輕量 wrapper）：
   - `applyAutoStart(enabled: boolean): void` → `app.setLoginItemSettings({ openAtLogin, openAsHidden })`
   - 失敗 log warning，不 crash
2. **main 整合**（`src/main/index.ts`）：
   - `app.whenReady` → 讀 `settings.autoStart` → `applyAutoStart`
   - 訂閱 `appState.on('settings:changed')` → autoStart 改變時 `applyAutoStart`
3. **「一般」tab 整合**（Stage 1 已做 toggle UI，這裡只接 main）：
   - 點 toggle → optimistic 儲存 → main 套 OS → 失敗回滾
4. **驗證**：
   - 開啟 toggle → 檢查 Windows registry `HKCU\...\Run` 有 Speak2T
   - 關閉 toggle → 檢查 registry 移除
   - 重啟 Windows → app 自動啟動 + 不彈主視窗（tray 常駐）

**Files touched**：
- `src/functions/autostart/manager.ts`（new）
- `src/main/index.ts`（啟動時套用 + settings 變更監聽）
- `src/renderer/settings/tabs/GeneralTab.tsx`（autoStart toggle 已做，stage 3 只驗證 wiring）

---

## 5. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| child_process spawn 在 Windows packaged 後路徑不同 | 中 | 下載壞掉 | spawn 用 `process.execPath` + 明確相對路徑；macOS/Linux P4 再驗 |
| 互動 CLI 加 --json flag 時破壞現有行為 | 低 | CLI 壞掉 | 保留原互動模式為預設；`--json` 是 opt-in |
| `app.setLoginItemSettings` 在 Windows 11 22H2+ 行為不同 | 中 | 自動啟動無效 | 失敗 log + UI 顯示「無法套用，請手動設定」 |
| 多 renderer 同時下載 | 低 | 浪費資源 | downloader singleton + state guard |
| 切 ASR engine 時正在辨識 | 中 | crash | 切換前檢查 `status === 'idle'`，否則 refuse + UI 顯示 |
| 設定變更後 hotkey 衝突 | 中 | 熱鍵失效 | stage 1 純顯示，user 改 settings.json 失敗時 console.warn；P3+ 加衝突偵測 |

---

## 6. 驗收標準

### 整體 P2 驗收

1. 開 Speak2T → 從系統匣開啟設定
2. 切到「一般」tab → 改「錄音模式」為 PTT → 按儲存 → 關 app → 重開 → 設定值正確
3. 切到「ASR」tab → 看到「sherpa-zh-en 未下載」狀態 + 下載按鈕
4. 點下載 → 進度條跑 → 完成 → 模型狀態變「已下載」
5. 按熱鍵 → 講話 → 文字注入（驗 ASR 真的用新下載的模型跑得起來）
6. 切到「一般」tab → 開「開機自動啟動」toggle → 檢查 Windows registry 有 Speak2T 條目
7. 切到「麥克風」tab → 選另一個麥克風 → 按熱鍵 → 從新麥克風收音

### Stage 驗收

- **Stage 1**：navbar 切換順暢、儲存後 reload 設定值正確、UI 不卡
- **Stage 2**：下載流程 end-to-end 跑完、ASR 自動可用、取消功能正常
- **Stage 3**：OS registry 確實被改、reboot 後 app 自動起（手動測試）

---

## 7. Tech Debt 處理

| Item | 處理方式 | 為何 P2 |
|------|----------|---------|
| 升級 `@vitejs/plugin-react` 到 v5 | 留 P2 完成後 | P2 動的檔案多，趁機處理 |
| 清理 console.log 風格 | 跟著 P2 commit 一起改 | P2 新程式碼直接用 logger pattern |
| 補 Vitest 測試 | 留 P3 | P2 focus UI，測試留穩定階段 |

---

## 8. 文件更新（每個 stage commit 必做）

- **CHANGELOG.md**：每個 stage 加 section
- **README.md**：P2 結束後更新「設定」+「下載」+「自動啟動」段落
- **SPEC.md §6**：P2 stage checkbox
- **D-7 決策修訂**：在 SPEC.md §7 加 v1.3 變動說明（首次啟動彈窗 → 設定頁 toggle）

---

## 9. 預估時程

| Stage | 工作 | 預估 |
|-------|------|------|
| 1 | 設定主視窗 refactor | 1.5 天 |
| 2 | 自動下載 UI | 1 天 |
| 3 | 開機啟動 | 0.5 天 |
| 文件 + commit | 全部 | 0.5 天 |
| **總計** | | **3.5 天** |

---

## 10. 待 user 確認

- [ ] **Plan GO**：以上設計可以動工？
- [ ] **D-7 簡化**：首次啟動彈窗改成「設定頁 toggle，預設 off」OK 嗎？
- [ ] **Hotkey 編輯**：stage 1 不做 UI 編輯（純顯示），OK 嗎？
- [ ] **Scope 邊界**：A+B+C 全部都要？還是有要砍/加的？
- [ ] **風險接受度**：child_process spawn 下載模型這個方案 OK？還是要 main 直接 fetch？
