# Speak2T P1 完整 Plan

**文件版本**：v1.0（定版，2026-08-19）
**建立日期**：2026-08-19
**適用 SPEC**：v1.2
**預估工時**：7 天

---

## 決策記錄（2026-08-19 user GO）

| # | 決策點 | 結果 | 影響 |
|---|--------|------|------|
| D-A | 熱鍵模式（D-1） | **Toggle 模式** | PTT 留 P1+1，不裝 native key hook |
| D-B | ASR 引擎（D-4） | **雙引擎**：sherpa-onnx-streaming 預設 + whisper.cpp 備援 | +1 天工（WhisperNodeAddon 整合） |
| D-C | 注入方式（D-6） | **兩者都做，設定可選**：剪貼簿+自動 Ctrl+V（預設）/ 純剪貼簿（備援） | +0.5 天工（設定檔殼） |

**工時明細**：D-A 0、+D-B 1、+D-C 0.5 → **7 天**（原 SPEC 估 3-5 天，已拉長一次）

---

## 0. 驗證結果摘要

實作前先完成 P0 收尾驗證 — 結論：**兩個引擎都可用，零意外**。

| 項目 | 結果 | 證據 |
|------|------|------|
| `sherpa-onnx-node` | ✅ 1.13.6 昨天 release | `npm view` 確認 |
| `sherpa-onnx-win-x64` | ✅ 23 MB prebuilt binary | optionalDependencies 機制 |
| Node.js 需求 | ✅ 18+，我們 24.7 | npm view engines 欄位 |
| 外部依賴 | ✅ 零 | dependencies: {} |
| Streaming API | ✅ `OnlineRecognizer` + `acceptWaveform` | 官方 API doc |
| 中文模型 | ✅ streaming-zipformer-bilingual-zh-en-2023-02-20 | GitHub release tarball |
| Whisper 備援 | ✅ `@kutalia/whisper-node-addon@1.1.0` | 125 MB prebuilt + Vulkan |
| Electron 相容 | ✅ whisper-node-addon 明確標 Electron | 套件描述 |
| AudioWorklet | ✅ Electron 33 完整支援 | Electron 文件 |

**結論**：沒有技術 blocker，動工前只要 user GO 即可。

---

## 1. P1 範圍（對齊 SPEC §6）

### 必做（in scope）

| 功能 | SPEC 對應 | 說明 |
|------|----------|------|
| 麥克風錄音 | §6.1 | AudioWorklet 抓 PCM，IPC 推 main |
| 兩種 ASR 引擎 | §6.2 | sherpa-onnx-streaming（預設）+ whisper.cpp |
| 模式切換 | D-1 | **Toggle 模式先做**（PTT 留 P1+1）|
| 文字注入 | §6.3 + D-6 | 剪貼簿 + 自動 Ctrl+V（先做這個）|
| 指示器浮窗 | §6.4 + D-2 | frameless transparent 視窗 + 音量條 |
| 模型下載輔助 | D-9, D-10 | 預設手動，提供 `npm run download-model <name>` script |
| 端到端測試 | — | 預錄 wav 跑完整閉環 |

### 不做（out of scope，P1+ 之後）

| 功能 | 為什麼不做 |
|------|------------|
| PTT 模式（長按） | 要 native key hook（uiohook-napi），先做 Toggle 驗證流程 |
| 按鍵注入（不用剪貼簿） | Electron sendInputEvent 不能跨 app；用 PowerShell SendKeys 副作用大 |
| 設定 UI（P2） | P1 先用環境變數或寫死預設值 |
| 自動模型下載 | 進度條 + HTTPS + 解壓，工作量不在 P1 範圍 |
| 開機啟動（D-7） | P2 範圍 |
| 標點自動修正（P3） | P3 範圍 |
| 繁中特定優化（P3） | P3 範圍 |
| VAD（silero-vad） | sherpa-onnx 內建 endpoint 偵測已足夠 |

---

## 2. 技術架構

### 2.1 模組佈局（per-function 垂直切分）

```
src/
├── main/                      # 現有
├── functions/
│   ├── hotkey/                # 現有 P0
│   ├── audio/                 # ← 新增：跨進程音訊（main 端 aggregator）
│   ├── asr/                   # ← 新增：ASR 引擎抽象 + 雙實作
│   │   ├── engine.ts          # AsrEngine 介面
│   │   ├── sherpa-onnx.ts     # SherpaOnnxEngine
│   │   ├── whisper-cpp.ts     # WhisperCppEngine
│   │   └── manager.ts         # AsrManager（管理當前引擎生命週期）
│   ├── injector/              # ← 新增：文字注入
│   │   └── clipboard.ts       # ClipboardInjector
│   ├── indicator/             # ← 新增：指示器浮窗
│   │   ├── window.ts          # IndicatorWindow class
│   │   └── state.ts           # 狀態機（idle / recording / processing）
│   └── settings/              # 預留 P2，本期只做 defaults.ts
├── preload/
│   └── index.ts               # ← 擴充 audio, asr, indicator, injector IPC
├── renderer/
│   ├── settings/              # 預留 P2
│   └── indicator/             # ← 新增：浮窗 UI（frameless，獨立入口）
│       ├── index.html
│       ├── index.tsx
│       └── App.tsx
└── shared/                    # 擴充 IPC channels, types, api
```

### 2.2 IPC contract 設計

新增 channels（在 `src/shared/ipc-channels.ts`）：

```ts
// renderer → main
AUDIO_CHUNK        = 'audio:chunk'        // Float32Array（Transferable）
HOTKEY_RECORD      = 'hotkey:record'      // PTT down / toggle on
HOTKEY_RELEASE     = 'hotkey:release'     // PTT up
INDICATOR_HIDE     = 'indicator:hide'     // 浮窗自己說「我準備好了可以隱藏」

// main → renderer (廣播)
ASR_PARTIAL        = 'asr:partial'        // { text, isEndpoint, segment }
ASR_FINAL          = 'asr:final'          // { text, durationMs }
ASR_ERROR          = 'asr:error'          // { code, message }

INDICATOR_STATE    = 'indicator:state'    // 'idle' | 'recording' | 'processing'
INDICATOR_LEVEL    = 'indicator:level'    // 0.0 ~ 1.0（音量）
INDICATOR_TEXT     = 'indicator:text'     // 顯示文字（partial 即時）

// main → system
INJECT_TEXT        = 'injector:inject'    // 內部觸發（main 自己呼叫 injector）
```

### 2.3 狀態機（核心）

```
                  hotkey.record (down)
        ┌──────────────────────────────────┐
        │                                  ▼
     [IDLE] ───────────────────────► [RECORDING]
        ▲                                  │
        │                                  │ hotkey.release (up)
        │                                  ▼
        │                          [PROCESSING]
        │                                  │
        │            ASR final + inject done
        └──────────────────────────────────┘
```

- **IDLE**：等待熱鍵
- **RECORDING**：AudioWorklet 抓 audio，IPC 推 main，main 餵 ASR，partial result 廣播
- **PROCESSING**：停止 audio capture，ASR 跑最後一輪解碼，注入文字，等完成回 IDLE

### 2.4 錄音方案（**不裝任何 audio 套件**）

sherpa-onnx 官方範例用 `naudiodon2`（要 prebuilt binary），但我們有更好的方案：

**用 Electron 內建 `navigator.mediaDevices.getUserMedia` + `AudioContext` + `AudioWorklet`**

- 0 依賴（瀏覽器原生 API）
- 跨平台一致行為
- 支援即時視覺化（AnalyserNode → React）
- main 進程只負責 ASR，不碰 audio capture

**流程**：

```
BrowserWindow (renderer)
  └─ AudioContext @ 16kHz
       └─ MediaStreamSource (getUserMedia mic)
            └─ AudioWorkletProcessor
                 └─ port.postMessage(Float32Array)  ← 每 100ms 推一次
                      └─ window.speak2t.audio.send(samples)  ← IPC
                           └─ preload 把 Float32Array 轉成 transferable
                                └─ main: audio.ingest(samples)
                                     └─ asr.feed(samples)
```

為什麼不直接用 `getUserMedia` 的 MediaRecorder？
- MediaRecorder 是壓縮格式（webm/opus），sherpa-onnx 要原始 PCM
- 即時解碼 + streaming ASR 需要 raw PCM

### 2.5 ASR 引擎抽象

```ts
// src/functions/asr/engine.ts
export interface AsrEngine {
  readonly name: string;
  init(config: AsrConfig): Promise<void>;
  start(): void;             // 建立 stream
  feed(samples: Float32Array, sampleRate: number): void;
  stop(): Promise<AsrResult>; // 結束串流，回傳最終結果
  dispose(): void;           // 釋放資源

  on(event: 'partial', cb: (text: string, isEndpoint: boolean) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}
```

**SherpaOnnxEngine**（預設）：
- `sherpa-onnx-node@1.13.6`
- `OnlineRecognizer` + `createStream()` + `acceptWaveform()` + `getResult()` + `isEndpoint()`
- 模型：streaming-zipformer-bilingual-zh-en-2023-02-20

**WhisperCppEngine**（備援）：
- `@kutalia/whisper-node-addon@1.1.0`
- 因為是 offline 模式（要整段音訊），所以 audio buffer 累積到 endpoint 才送一次
- 模型：ggml-small.bin（中文+英文，~460 MB）

切換設計：**兩個引擎互斥，不同時載入**（避免吃滿 CPU）。
使用者裝了兩個就可在設定切換；沒裝就 fallback 提示。

### 2.6 文字注入（剪貼簿方案）

```ts
// src/functions/injector/clipboard.ts
export class ClipboardInjector {
  async inject(text: string): Promise<boolean> {
    if (!text.trim()) return false;

    // 1. 備份原剪貼簿（60s 內可復原）
    const original = await clipboard.readText();

    // 2. 寫入新文字
    await clipboard.writeText(text);

    // 3. 模擬 Ctrl+V（用 PowerShell SendKeys）
    await this.sendCtrlV();

    // 4. 短延遲後還原（給目標 app 時間貼上）
    await sleep(200);
    await clipboard.writeText(original);

    return true;
  }

  private async sendCtrlV(): Promise<void> {
    // spawn powershell -Command "Add-Type ...; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    // 或用 powershell 載 System.Windows.Forms
  }
}
```

**限制**：
- 剪貼簿會短暫被覆蓋（~200ms），大多數情境可接受
- 焦點必須在可貼上的視窗（沒切換焦點的話 ctrl+v 會送錯地方）
- **已知風險**：如果 `sendCtrlV` 失敗（防毒阻擋、UAC 視窗焦點等），會留字在剪貼簿

**進階方案（不做，留 P1+1）**：
- 用 `clipboard.writeText` 後 `setForegroundWindow(getLastActiveWindow())` 再 `SendKeys`
- 這需要 win32 API binding（`koffi` 或 `ffi-napi`）

### 2.7 指示器浮窗

**獨立 frameless BrowserWindow**：

```ts
// src/functions/indicator/window.ts
class IndicatorWindow {
  private win: BrowserWindow;

  show() {
    if (!this.win) {
      this.win = new BrowserWindow({
        width: 320, height: 80,
        frame: false, transparent: true, alwaysOnTop: true,
        skipTaskbar: true, resizable: false, focusable: false,
        webPreferences: { preload: '...indicator-preload.js' }
      });
      this.win.loadURL('http://localhost:5173/indicator.html');
    }
    this.setPosition();  // 螢幕底部中央
    this.win.show();
  }

  setState(state: 'idle' | 'recording' | 'processing') { /* IPC */ }
  setLevel(level: number) { /* IPC，音量條 */ }
  setText(text: string) { /* IPC，partial */ }
  hide() { /* 等動畫結束再 hide */ }
}
```

**Renderer**（`src/renderer/indicator/`）：
- React 18
- 純視覺：圓角面板 + 顏色 + 音量條 + partial 文字
- 不需要複雜狀態管理
- 收到 `indicator:hide` 自己 close 視窗

**位置策略（D-2 先做「螢幕底部中央」預設）**：
- electron `screen.getPrimaryDisplay().workArea` 拿工作區
- 浮窗 y = workArea.bottom - 80 - 32
- x = (workArea.width - 320) / 2
- 「跟隨游標」留 P1+1

### 2.8 熱鍵：Toggle 模式優先

**現狀**：P0 用 `globalShortcut.register('CommandOrControl+Shift+Space', ...)`，是「按下觸發」。

**PTT 模式**（長按）：
- 要 native key hook：`uiohook-napi` 或自己用 Windows API SetWindowsHookEx
- 風險：要多裝一個 native binding，可能踩 @nut-tree 一樣的 404 坑
- **決策**：P1 不做，預設 Toggle

**Toggle 模式**：
- 熱鍵 down 一次 → RECORDING
- 再 down 一次 → PROCESSING → IDLE
- globalShortcut 已經支援，不用改

**D-1 的「PTT vs Toggle」**先統一用 Toggle 交付，P1 驗證後再決定要不要 PTT。

### 2.9 模型下載輔助（D-9 + D-10）

**預設**：使用者手動下載到 `%APPDATA%\speak2t\models\`

**輔助 script**：`scripts/download-model.mjs`
```bash
# 互動式選單
npm run download-model

# 或直接指定
npm run download-model sherpa-zh-en
npm run download-model whisper-small
```

**支援的模型**：

| 名稱 | 引擎 | URL | 大小 | 預設 |
|------|------|-----|------|------|
| sherpa-streaming-zh-en | sherpa-onnx | github.com/k2-fsa/.../streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2 | ~340 MB | ✅ |
| whisper-small | whisper.cpp | huggingface.co/.../ggml-small.bin | ~460 MB |   |

**不做**：UI 自動下載（進度條 + HTTPS + 解壓，工作量大，留 P2）

---

## 3. 實作階段

### 階段 0：P0 收尾（半天，0.5 天）
- commit `package.json` + `package-lock.json` 的依賴清理結果
- 跑一次 `npm run dev` 確認 P0 仍正常

### 階段 1：依賴 + AudioWorklet 錄音（1 天）
1. `npm install sherpa-onnx-node`（自動拉 sherpa-onnx-win-x64）
2. 驗證 binary 載入（寫 `scripts/check-asr.mjs`，require + 列出 available model types）
3. 在 renderer 加 `AudioContext` + `MediaStreamSource` + `AudioWorklet` 抓 16kHz mono Float32
4. IPC channel `audio:chunk`（Float32Array transferable）
5. main 端 `audio.ingest()` 寫到暫存 wav 檔做 smoke test
6. ✅ 驗收：說話後 main 端有收到 PCM 資料

### 階段 2：ASR 整合（1.5 天）
1. 實作 `AsrEngine` 介面（`src/functions/asr/engine.ts`）
2. 實作 `SherpaOnnxEngine`（用 sherpa-onnx-node）
   - config 結構對齊官方範例
   - partial + endpoint 事件
3. 改 IPC：audio:chunk → asr.feed()，asr 事件廣播
4. 加單元測試：用預錄 wav 跑完整 ASR
5. ✅ 驗收：說「你好世界」→ renderer 收到 partial `你好世界`

### 階段 3：文字注入（1 天）
1. 實作 `ClipboardInjector`
2. PowerShell SendKeys 包裝
3. 整合：asr final → injector.inject()
4. 手動測試：開記事本 → 按熱鍵 → 文字進記事本
5. ✅ 驗收：閉環完成

### 階段 4：兩種模式 + 指示器（1.5 天）
1. 狀態機實作（IDLE/RECORDING/PROCESSING）
2. Toggle 熱鍵邏輯
3. `IndicatorWindow` class
4. 浮窗 renderer UI（frameless + transparent + 動畫）
5. 音量計算（peak amplitude from audio chunks）
6. ✅ 驗收：開 Word → 按熱鍵 → 浮窗出現「錄音中」+ 音量條 → 講完 → 浮窗消失 + 文字進 Word

### 階段 5：Whisper 引擎 + 雙引擎切換（1 天）
1. 實作 `WhisperCppEngine`（用 `@kutalia/whisper-node-addon`）
   - offline 模式：累積 audio buffer 到 endpoint 一次送
   - 較慢但品質好
2. `AsrManager`：根據設定切換當前引擎
3. 預設值：sherpa-onnx-streaming
4. ✅ 驗收：設定改成 whisper 後，模型載入成功，語音辨識仍正常

### 階段 6：模型下載 script（0.5 天）
1. `scripts/download-model.mjs`：用 `https` 模組下載 + 進度條
2. 自動解 tar.bz2 / 直接搬 bin
3. 放到 `%APPDATA%\speak2t\models\<model-name>\`
4. 設定檔寫到 `settings.json`（先做 settings.json 持久化殼）
5. ✅ 驗收：`npm run download-model sherpa-zh-en` 一鍵下載成功

### 階段 7：端到端驗收 + 修 bug（1 天）
1. 完整 E2E 測試：開瀏覽器、開 Word、開記事本，逐一測
2. 修 corner cases（音訊權限、視窗焦點、長時錄音、模型切換熱重載）
3. 補 `docs/TROUBLESHOOTING.md` 常見問題
4. 補 `README.md` P1 對應章節
5. 寫 commit，user push
6. ✅ 驗收：完整閉環

**總計**：0.5 + 1 + 1.5 + 1 + 1.5 + 1 + 0.5 + 1 = **8 工作天**（超 SPEC 估的 3-5 天）

**預估修正**：合併階段 0 到階段 1、合併階段 6 到階段 5，**壓到 6 天**。

---

## 4. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| `sherpa-onnx-node` 在 Electron 33 ABI 不相容 | 中 | 高 | npm 套件頁聲明相容 Node 18+，Electron 用 Node 20.18。**先用最小 Hello World 驗證** |
| `sherpa-onnx-win-x64` 沒包含 onnxruntime DLL | 低 | 高 | 查 GitHub release 確認；必要時改用 `@nut-tree` 替代（404 已知） |
| AudioWorklet 在 Electron renderer 路徑問題 | 低 | 中 | 用 `audioWorklet.addModule('/worklet.js')`，Vite 要支援 |
| PowerShell SendKeys 被防毒擋 | 中 | 中 | 退路：只做剪貼簿，不自動 Ctrl+V（user 手動貼） |
| Whisper 引擎依賴 `node-abi` 對 Electron 不相容 | 中 | 中 | Whisper 套件頁標 Electron 支援；**先 smoke test** |
| float32 IPC 大資料量塞爆 event loop | 低 | 中 | 用 Transferable + 100ms chunk（~25 KB），不影響 |
| 浮窗焦點被切走時 SendKeys 送錯地方 | 高 | 中 | 注入前先 `BrowserWindow.getFocusedWindow()` 記下 focus；或者只用剪貼簿不要 SendKeys（更穩） |
| 麥克風權限被使用者拒絕 | 中 | 中 | 開啟時顯眼提示「需要麥克風權限」+ 跳設定教學 |

---

## 5. 不在 P1 範圍（給 user 預期管理）

- ❌ PTT（長按）模式
- ❌ 熱鍵自訂 UI（P2）
- ❌ 設定主視窗（P2）
- ❌ 開機啟動（D-7，P2）
- ❌ 自動模型下載進度條（P2）
- ❌ 標點自動修正（P3）
- ❌ 繁中特定優化（P3）
- ❌ 多段歷史（P5）
- ❌ 多麥克風切換 UI（介面已預留，UI P2）

---

## 6. 驗收標準（P1 完成定義）

1. ✅ 熱鍵 `Ctrl+Shift+Space` toggle 開關錄音
2. ✅ 指示器浮窗正確顯示三種狀態（idle/recording/processing）+ 音量條
3. ✅ 講中文（5-30 秒）→ 文字出現在當前焦點視窗
4. ✅ 講中英混講（"Hello 你好 world 世界"）→ 完整辨識
5. ✅ 設定切換兩個引擎（sherpa-onnx / whisper）都能 work
6. ✅ 模型下載 script 一鍵完成
7. ✅ 預設模型目錄 `%APPDATA%\speak2t\models\` 自動偵測
8. ✅ `npm run typecheck` + `npm run lint` 全綠
9. ✅ E2E 測試：預錄 wav 跑完整閉環 PASS
10. ✅ 兩個獨立 commit（feature + test），user push

---

## 7. 給 user 的問題（在 v1.0 定版時已解決）

~~三題決策皆已於 2026-08-19 完成（見文件頂部「決策記錄」）。~~

---

## 8. 動工前最後確認

User 確認上面 3 個決策後，給個 **「GO」** 就會按以下順序開工：

1. **階段 0**：P0 收尾 commit（半天）
2. **階段 1**：sherpa-onnx-node 安裝 + AudioWorklet 錄音（1 天）
3. **階段 2**：ASR 整合 + SherpaOnnxEngine（1.5 天）
4. **階段 3**：ClipboardInjector + PowerShell SendKeys（1 天）
5. **階段 4**：Toggle 模式 + 指示器浮窗（1.5 天）
6. **階段 5**：WhisperCppEngine + 雙引擎切換（1 天）
7. **階段 6**：模型下載 script + 設定檔殼（0.5 天）
8. **階段 7**：端到端驗收 + commit（1 天）

**每個階段結束會停下來等 user 檢視**，不會一次衝完。
**重大 refactor 或非預期狀況會暫停請示**。
