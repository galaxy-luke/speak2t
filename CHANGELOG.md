# Changelog

## [P1] - 2026-08-20

### Highlights

Speak2T 進入 P1 階段，達成語音辨識 + 文字注入的完整閉環。  
預設引擎：**sherpa-onnx-streaming**（低延遲），備援：**whisper.cpp**（離線，高繁中品質）。

### Added

#### Stage 1 — 麥克風擷取 + IPC 鏈路
- `public/audio-worklet.js`：AudioWorklet processor，16kHz mono Float32，100ms chunks
- `src/functions/audio/ingest.ts`：audio buffer 累積 + 音量計算 + debug wav 寫檔
- IPC channels: `audio:chunk`, `startRecord`, `stopRecord`
- `src/renderer/settings/SettingsApp.tsx`：按鈕觸發 getUserMedia + AudioContext + AudioWorklet 鏈路
- 音量條 UI 顯示即時音量

#### Stage 2 — ASR 引擎整合（sherpa-onnx）
- 裝 `sherpa-onnx-node@1.13.6`（prebuilt Windows x64，~23MB）
- `src/functions/asr/engine.ts`：AsrEngine 抽象介面
- `src/functions/asr/sherpa-onnx.ts`：SherpaOnnxEngine 實作（OnlineRecognizer streaming）
- `src/functions/asr/manager.ts`：AsrManager 包裝，事件 → IPC 廣播
- `sherpa-onnx-node.d.ts` ambient declaration
- graceful handle 模型不存在（不 crash，warn log）

#### Stage 3 — 文字注入
- `src/functions/injector/clipboard.ts`：ClipboardInjector
- 兩種模式（D-C 決策）：
  - `clipboard`：純寫剪貼簿（user 手動 Ctrl+V）
  - `clipboard-and-paste`：寫剪貼簿 + PowerShell SendKeys Ctrl+V（預設）
- 備份原剪貼簿 + 200ms 還原
- windowsHide 不彈黑視窗
- PowerShell SendKeys 失敗時不丟 exception，返回 `{ ok: false, reason }`

#### Stage 4 — Toggle 熱鍵 + 指示器浮窗
- `src/functions/hotkey/manager.ts` 改 EventEmitter + toggle 狀態機（D-A 決策）
- `src/main/windows.ts` 加 `createIndicatorWindow()`：frameless + transparent + alwaysOnTop
- 位置：螢幕底部中央（D-2 預設）
- `src/renderer/indicator/IndicatorApp.tsx`：圓角面板 + 狀態點 + 音量條 + partial 文字
- 查詢 string 切換 settings / indicator 兩個 view（共用 vite entry）
- main 訂閱 `appState.status:changed` 自動 show/hide indicator

#### Stage 5 — Whisper.cpp 引擎（備援）
- 裝 `@kutalia/whisper-node-addon@1.1.0`（prebuilt Windows x64 + Vulkan）
- `src/functions/asr/whisper-cpp.ts`：WhisperCppEngine 實作（offline 模式）
- `whisper-node-addon.d.ts` ambient declaration
- 累積 audio buffer → 寫 tmp wav → `whisperAddon.transcribe()` → emit 一次性 final partial
- 兩個引擎互斥（一次只持有一個 engine instance）
- 設定切換時 `AsrManager.switchEngine()` dispose 舊的、init 新的

#### Stage 6 — 模型下載 + 設定檔持久化
- `scripts/download-model.mjs`：互動式 CLI
  - `npm run download-model` → 互動選單
  - `npm run download-model sherpa-zh-en` / `whisper-small` → 直接指定
  - 進度條（每 200ms 更新，含速度、剩餘時間）
  - Windows 10+ 內建 `tar.exe` 解 tar.bz2
  - whisper .bin 直接 rename 存到目標
  - 退出代碼：0/1/2/3/4 對應 成功/下載失敗/解壓失敗/取消/參數錯誤
- `src/main/app-state.ts` 改讀寫磁碟
  - 啟動從 `<userData>/settings.json` 讀設定
  - `updateSettings()` 同步寫回磁碟
  - 容錯：檔案不存在/解析失敗 → fallback DEFAULT

#### Stage 6.5 — 麥克風設備選擇（user 加碼）
- `enumerateDevices()` 抓麥克風清單
- `devicechange` event 自動偵測新硬體
- 拉選單 UI（在 settings window 內）
- 持久化選擇的 `deviceId` 到 settings
- 切換時熱重連（下次 `getUserMedia` 用新 deviceId constraints）

### Changed

- **shared/types.ts**：AppSettings 擴充（asrEngine、asrModelPreset、audioSampleRate、customModelPath、audioDeviceId）
- **shared/ipc-channels.ts**：從 5 個 channel 擴充到 14 個（P1 全套）
- **shared/api.ts**：Speak2tApi 從 2 個 method 擴充到 15 個
- **preload/index.ts**：contextBridge 暴露 14 個 event subscriber + 3 個 send method
- **main/index.ts**：從 92 行擴充到 270+ 行（hotkey toggle wiring、ASR manager、inject 整合、status 訂閱）
- **hotkey manager 行為**：P0 「按下 → 切 recording 2 秒後回 idle」廢除，改為 toggle 模式

### Fixed

- `audio-worklet.js` 路徑從根目錄 `public/` 改到 `src/renderer/public/`（配合 vite.config.ts 的 `publicDir` 設定）
- `AsrModelPreset` enum 值對齊 GitHub release 實際解壓目錄名（`sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`）
- CSS module ambient declaration 修 P0 typecheck gap（`src/renderer/css.d.ts`）

### Out of Scope（P1 內明確不做）

- ❌ PTT（長按）模式 — 留 P1+1，需要 uiohook-napi native key hook
- ❌ 設定主視窗（獨立 UI）— 留 P2（mic 設備選擇已塞進現有 settings window）
- ❌ 自動模型下載 UI + 進度條 — 留 P2
- ❌ 開機啟動（D-7） — 留 P2
- ❌ 標點自動修正（P3）
- ❌ 繁中特定優化（P3）
- ❌ 多段歷史（P5）
- ❌ macOS 支援（規格書 v1.2 列為 follow-up，目前 Windows 11 優先）
- ❌ electron-builder 打包 + NSIS installer — 留 P4

### Performance

- sherpa-onnx: 100-300ms 延遲（streaming 模式）
- whisper.cpp: 1-3s+ 延遲（取決於 audio 長度，offline 模式）
- Float32 audio chunk IPC: 6.4KB / 100ms（拷貝可接受，未用 transferable）
- indicator 視窗 500ms 延遲隱藏（讓 final 結果短暫顯示）

### Dependencies

新增：
- `sherpa-onnx-node@^1.13.6`（含 optional `sherpa-onnx-win-x64` prebuilt）
- `@kutalia/whisper-node-addon@^1.1.0`（含 .node prebuilt binary）

開發依賴不變。

### Commits

累計 10 個 commit（領先 origin/main 9 commit）：
1. `feaeea0` P0 initial + SPEC v1.0
2. `e071bf7` P0 verified + dep cleanup
3. `77a4f06` docs: P1 plan v1.0
4. `c4a3f70` feat: P1 stage 1 - mic capture + IPC
5. `33ae7c2` feat: P1 stage 2 - ASR engine
6. `1549cef` feat: P1 stage 3 - ClipboardInjector
7. `b4694ec` fix: audio-worklet path
8. `a50b171` feat: P1 stage 4 - Toggle + indicator
9. `f4dccfb` feat: P1 stage 5 - Whisper engine
10. `508cd22` feat: P1 stage 6 - download-model
11. `bca2289` feat: P1 stage 6.5 - mic device selection

### User Setup Required

P1 完成後，user 需執行一次性 setup 步驟：

```powershell
cd D:\My_Projects\Speak2T
npm run download-model sherpa-zh-en   # 340 MB tar.bz2
npm run dev
```

下載完模型後重啟 app，ASR 就能用。

### Known Limitations

- Stage 1 mic 流程需「按下開始」後才能看到完整 device label（瀏覽器權限機制）
- Stage 5 Whisper 1.1.0 套件 .d.ts 自寫，未對應實際 binary 全部 API（只覆蓋用到的部分）
- Stage 6 download-model 依賴 Windows 10+ 內建 `tar.exe`（其他平台需手動解壓）
- dev script 有 vite 8 / plugin-react 4 peer dep 警告，用 `--legacy-peer-deps` 跳過（plan 升級 plugin-react 留 P2 tech debt）

### Tech Debt（累積到 P2 處理）

- 升級 `@vitejs/plugin-react` 到 v5（支援 vite 8）
- vite 6+ deprecation 警告（jsx / esbuild / oxc）
- npm audit 19 個漏洞（Electron / Vite transitive，等上游修）
- PTT 模式（uiohook-napi）
- 設定主視窗（獨立 UI）
