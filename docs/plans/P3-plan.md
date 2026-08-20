# Speak2T P3 Plan — 繁中優化（標點後處理 + 失敗重試）

> **狀態**: 草稿 v0.1 — 等 user GO 才動工
> **日期**: 2026-08-20
> **範圍**: P2 完成後的下一階段，3 個 stage、約 2.5 個工作天
> **源頭決策**: user 2026-08-20 說「GO P3」

---

## 1. 目標

讓 Speak2T 真正適合台灣繁中使用者：把 ASR 模型的輸出修得更貼近自然書寫，並具備基本的容錯能力。

### 1.1 P2 留下的痛點

| 痛點 | 表現 | 影響 |
|------|------|------|
| sherpa-onnx 繁中標點常有錯 | 句尾無句號、英文逗號、缺空格 | 寫稿/email 需要人工修 |
| 句中英文混用時缺空格 | `我今天meeting` | 閱讀體驗差 |
| 模型失敗時直接吐空字串 | 無重試、無提示 | 偶爾要重講一次 |
| 兩個引擎切換要手動 | sherpa 卡住就沒救 | 可用性打折 |

### 1.2 非目標（Out of Scope）

明確不做（避免 scope 漂移）：
- ❌ **自訂詞彙表**（O-2 已砍，user 確認不要）
- ❌ 中英混用識別測試（這是驗收項不是 feature，留最後做驗收）
- ❌ 翻譯功能（純轉文字）
- ❌ 即時標點（partial 階段不做後處理，只在 final 階段做）
- ❌ 文法錯誤修正（focus 在標點 + 空格）
- ❌ 多段編輯/歷史（留 P5）

---

## 2. 範圍（3 個 stage）

| Stage | 名稱 | 工時 | 重要程度 |
|-------|------|------|----------|
| **1** | 標點自動修正（後處理器） | 1 天 | 高 |
| **2** | 失敗重試 / 引擎降級 | 1 天 | 中 |
| **3** | 設定 toggle 控制後處理 + 驗收測試 | 0.5 天 | 中 |

**總計**：~2.5 天

---

## 3. 設計原則

### 3.1 整體策略

- **後處理器模組化**：獨立 `src/functions/postprocess/` 模組，與 ASR 解耦
- **規則優先，ML 不用**：用正則 + 規則做標點修正，零依賴、零延遲、可預測
- **降級策略最小可行**：sherpa 失敗 → 切 whisper 重試一次，仍失敗就放棄
- **設定驅動**：後處理可以關（避免覆寫 user 已經正確的輸出）

### 3.2 標點自動修正（Stage 1）

**整合位置**：`AsrManager.stop()` 把 `result.text` 餵給 postprocess，回傳修正後文字

**規則清單**（先做這 5 條最重要的）：

| # | 規則 | 範例 |
|---|------|------|
| 1 | 中英之間加空格 | `我今天meeting` → `我今天 meeting` |
| 2 | 數字與中文之間加空格 | `蘋果13` → `蘋果 13` |
| 3 | 句尾無標點 → 加句號 | `今天天氣很好` → `今天天氣很好。` |
| 4 | 英文逗號→中文逗號 | `hello,world` → `hello，world` |
| 5 | 連續空白 → 單個空白 | `今天  天氣` → `今天 天氣` |

**進階規則**（可選，看時間）：

| # | 規則 | 範例 |
|---|------|------|
| 6 | 英文問號/驚嘆號統一 | `What?` 保留，`是嗎?` → `是嗎？` |
| 7 | 連續句號折疊 | `今天..天氣` → `今天.. 天氣`（保守策略：只清多於 2 個的） |
| 8 | 開頭空白 trim | ` 今天天氣` → `今天天氣` |
| 9 | 全形空白 → 半形 | （罕見，但會出現） |
| 10 | 數字千分位 | 不做（這是語義理解，不該後處理硬塞） |

**實作**：

```typescript
// src/functions/postprocess/punctuation.ts
export function postprocess(input: string, options?: PostprocessOptions): string {
  let text = input;
  for (const rule of RULES) {
    if (options?.disabledRules?.includes(rule.id)) continue;
    text = rule.apply(text);
  }
  return text.trim();
}

const RULES: Rule[] = [
  { id: 'cn-en-space', apply: addSpaceBetweenCnEn, ... },
  { id: 'cn-digit-space', apply: addSpaceBetweenCnDigit, ... },
  { id: 'trailing-period', apply: addTrailingPeriod, ... },
  { id: 'comma-normalize', apply: normalizeComma, ... },
  { id: 'collapse-spaces', apply: collapseSpaces, ... },
];
```

**規則模組化設計**：
- 每個規則是 `{ id, apply, description, enabled }`
- 規則順序很重要（空格先做、再做標點）
- 規則可以獨立測試（純函式）
- 之後要加規則就寫新 function 加進陣列

**關於「中英之間加空格」**：
- 要避開常見英文詞（`e-mail`, `iPhone`, `2C`）— 用 lookahead/lookbehind 判斷
- 簡化版：`/[一-鿿](?=[a-zA-Z])|[a-zA-Z](?=[一-鿿])/g` 然後在中英交界加空格
- 但 iPhone 會被改成 `i Phone` — 接受這個 trade-off（user 可關後處理）
- 之後可用 hot-word 排除（但 O-2 砍詞彙表，目前不做）

**安全考量**：
- 每條規則都有對應 unit test
- 全 disabled 時 = no-op，效能零成本
- 對 1-3 個字元短字串不做事（避免 over-engineering）

### 3.3 失敗重試 / 引擎降級（Stage 2）

**設計**：

```
[sherpa-onnx 啟動失敗 OR 連續 3 次 partial timeout]
   ↓
[AsrManager 偵測 → 自動切換到 whisper-cpp]
   ↓
[顯示通知：已切換到備援引擎，品質可能略降]
   ↓
[新一輪錄音用 whisper]
   ↓
[sherpa 模型修復後可在設定頁手動切回]
```

**實作要點**：

1. **AsrManager 新增自動降級**：
   - `init()` 失敗 → 不直接 disable ASR，try fallback engine
   - `start()`/`feed()` 連續失敗 → 標記 degraded，下次自動用備援
   - `stop()` 失敗 → 視為此次失敗，下次降級

2. **失敗偵測條件**：
   - 模型檔缺失 → 啟動時偵測 → 自動切換
   - `acceptWaveform` 拋錯 → 標記
   - 5 秒內無任何 partial 輸出（但 audio 有進來）→ 視為卡住
   - 連續 2 次失敗 → 切換引擎

3. **不無限降級**：
   - sherpa → whisper 切一次就停
   - whisper 也失敗 → 停止 ASR，UI 顯示錯誤

4. **新事件**：
   - `ASR_ENGINE_DEGRADED`（main→renderer 廣播）
   - 帶 `from: 'sherpa-onnx', to: 'whisper-cpp', reason: string`

5. **設定 toggle**（一般 tab 加「自動引擎降級」checkbox，預設開）

### 3.4 設定 toggle + 驗收（Stage 3）

**設定頁新增**：

- 一般 tab 加「自動標點修正」checkbox（預設開）
- 一般 tab 加「自動引擎降級」checkbox（預設開）
- 進階 tab 加「中英混用測試」按鈕：點下去跑一組固定文本，顯示 ASR 結果

**驗收測試文本**（5 句，覆蓋典型場景）：

```
1. 我今天下午三點有個 meeting，要跟客戶討論新產品。
2. 蘋果 iPhone 15 終於出了，價格 NT$35,900 起。
3. 請把這封信轉給 John 跟 Mary，明天中午前回覆。
4. 中英混用測試：API 文件寫得很清楚，但 RAG 還沒做。
5. 你好嗎？最近過得怎麼樣？需要幫忙嗎？
```

點按鈕後：
- 把這段文字用 TTS 念出來（用 Web Speech API）
- 把 TTS 的音訊用 ASR 辨識回來
- 顯示原始 vs 辨識結果 vs 後處理結果

**TTS 用 Web Speech API**（免費、不用新依賴）：
- `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`
- 然後用 `MediaStreamAudioDestinationNode` 抓到音訊
- 餵給 ASR 測試

**注意**：Web Speech API 在不同瀏覽器品質差異大，zh-TW TTS 品質可能不完美。但作為基本驗收夠用。如果太糟，Stage 3 只做 toggle，不做 in-app TTS 測試。

---

## 4. Stage 拆分

### Stage 1：標點自動修正（1 天）

**目標**：獨立後處理模組，AsrManager 整合，unit test 覆蓋

**步驟**：
1. **新增 `src/functions/postprocess/` 模組**：
   - `types.ts`：Rule / PostprocessOptions 介面
   - `rules/`：每條規則一個檔（5-10 條）
   - `punctuation.ts`：主函式 `postprocess(input, options?)`
   - `index.ts`：re-export
2. **新增 Vitest 測試**：
   - `tests/postprocess/punctuation.test.ts`：每條規則至少 3 個 case
   - 覆蓋空字串、純英文、純中文、混合、邊界
3. **整合 AsrManager**：
   - `stop()` 把 text 餵給 `postprocess()`
   - 結果當 final 廣播（partial 還是 raw）
   - 失敗時 fallback 原始 text
4. **加 IPC event**：`ASR_POSTPROCESSED` payload 含 `{ original, processed, rulesApplied }`（給設定頁 debug 用）
5. **驗證**：
   - unit test 全綠
   - 用真實 ASR 跑 5 句測試文本，確認修正正確

**新增檔案**：
- `src/functions/postprocess/types.ts`
- `src/functions/postprocess/punctuation.ts`
- `src/functions/postprocess/index.ts`
- `src/functions/postprocess/rules/cn-en-space.ts`
- `src/functions/postprocess/rules/cn-digit-space.ts`
- `src/functions/postprocess/rules/trailing-period.ts`
- `src/functions/postprocess/rules/comma-normalize.ts`
- `src/functions/postprocess/rules/collapse-spaces.ts`
- `src/functions/postprocess/rules/trim-whitespace.ts`
- `tests/postprocess/punctuation.test.ts`

**修改檔案**：
- `src/functions/asr/manager.ts`：整合 postprocess
- `src/shared/types.ts`：加 `postprocessEnabled: boolean`、`autoDegrade: boolean`
- `src/shared/ipc-channels.ts`：加 `ASR_POSTPROCESSED` broadcast
- `src/shared/api.ts`：加 `AsrPostprocessedPayload`
- `src/preload/index.ts`：加 event subscriber
- `src/main/index.ts`：廣播 ASR_POSTPROCESSED

### Stage 2：失敗重試 / 引擎降級（1 天）

**目標**：sherpa 失敗時自動切 whisper，避免 ASR 完全死掉

**步驟**：
1. **AsrManager 新增降級邏輯**：
   - 啟動時若 `init()` 失敗且 `autoDegrade` 開 → 試備援引擎
   - 每次 `feed()` 失敗計數器 +1
   - 連續 2 次失敗 → 切引擎 + 廣播 `ASR_ENGINE_DEGRADED`
2. **失敗偵測**：
   - 啟動時：`init()` reject
   - 運行中：`acceptWaveform` / `decode` 拋錯
   - 卡住：5 秒內無 partial 輸出（超時）
3. **新 IPC 事件**：
   - `ASR_ENGINE_DEGRADED` payload `{ from, to, reason, timestamp }`
   - renderer 訂閱，顯示「已切換到備援引擎」toast
4. **狀態變化**：
   - 當前 engine 從 `sherpa-onnx` 變 `whisper-cpp`（runtime）
   - settings 裡的 `asrEngine` 仍是 `sherpa-onnx`（user 設定）
   - 補一個 runtime state `currentEngine: AsrEngineType`
5. **驗證**：
   - 把 sherpa 模型檔移到別處 → 重啟 app → 自動切 whisper
   - 在運行中讓 sherpa 拋錯 → toast 出現、引擎切換

**修改檔案**：
- `src/functions/asr/manager.ts`：大幅擴充降級邏輯
- `src/shared/ipc-channels.ts`：加 `ASR_ENGINE_DEGRADED`
- `src/shared/api.ts`：加 payload type
- `src/preload/index.ts`：加 event subscriber
- `src/main/index.ts`：廣播

### Stage 3：設定 toggle + 驗收測試（0.5 天）

**目標**：設定頁可控制後處理 + 降級，加 in-app 測試按鈕

**步驟**：
1. **GeneralTab 加 toggle**：
   - 「自動標點修正」→ 寫 `settings.postprocessEnabled`
   - 「自動引擎降級」→ 寫 `settings.autoDegrade`
2. **AdvancedTab 加測試按鈕**：
   - 「執行中英混用測試」按鈕
   - 點下去跑 TTS → ASR → 顯示結果
3. **AsrTab 加結果顯示**：
   - 訂閱 `ASR_POSTPROCESSED` 事件
   - 顯示「原始 vs 後處理」對比
4. **驗證**：
   - toggle off → 後處理 = no-op
   - 跑測試文本 → 看到對比結果

**修改檔案**：
- `src/renderer/settings/tabs/GeneralTab.tsx`：加 2 個 toggle
- `src/renderer/settings/tabs/AdvancedTab.tsx`：加測試按鈕
- `src/renderer/settings/SettingsApp.tsx`：處理新欄位

---

## 5. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| 中英加空格誤傷 `iPhone` / `e-mail` | 高 | 寫作麻煩 | 規則 toggle 可關；先做簡單版，hot-word 排除留 future |
| 自動降級造成品質下降 | 中 | user 體驗不穩 | 廣播 toast 明確告知；可手動切回 |
| Web Speech API 品質差（Stage 3） | 高 | 測試不可靠 | Stage 3 測試功能可選，失敗就 skip 不阻塞 P3 |
| 後處理規則順序錯亂 | 中 | 結果不對 | unit test 嚴格覆蓋；規則順序文件化 |
| TTS + ASR 端到端很慢 | 中 | 測試耗時 | 5 句文本，預估 30s-1min，可接受 |

---

## 6. 驗收標準

### 整體 P3 驗收

1. 開設定 → 一般 tab → 看到「自動標點修正」「自動引擎降級」toggle，預設開
2. 講一句「我今天meeting蘋果13」→ 注入的文字是「我今天 meeting 蘋果 13。」
3. 故意把 sherpa 模型檔移走 → 重啟 app → 自動用 whisper 跑 → 看到「已切換到備援引擎」toast
4. 關「自動標點修正」toggle → ASR 結果不再被後處理
5. 進階 tab 跑中英混用測試 → 看到 5 句的 ASR + 後處理結果對比

### Stage 驗收

- **Stage 1**：unit test 全綠（≥20 個 case），真實 ASR 跑 5 句測試文本
- **Stage 2**：sherpa 失敗 → whisper 自動接手，toast 正確
- **Stage 3**：toggle 正確控制後處理；測試按鈕可運行

---

## 7. P3 不做的事（明確邊界）

- ❌ 詞彙表（O-2 已砍）
- ❌ 文法錯誤修正
- ❌ 即時標點（partial 階段不做）
- ❌ 中英混用識別測試的 in-app TTS 自動跑（手動點按鈕才跑）
- ❌ 翻譯
- ❌ 自訂規則（user 加新後處理規則的機制）
- ❌ 標點「個人化」（不同人有不同書寫風格）

---

## 8. 文件更新

- **CHANGELOG.md**：每個 stage 加 section
- **SPEC.md §6 P3**：checkbox 標 [x]
- **README.md**：在「設定」section 加新 toggle 說明

---

## 9. 預估時程

| Stage | 工作 | 預估 |
|-------|------|------|
| 1 | 標點自動修正 | 1 天 |
| 2 | 失敗重試 / 引擎降級 | 1 天 |
| 3 | 設定 toggle + 驗收 | 0.5 天 |
| 文件 + commit | 全部 | 0.5 天 |
| **總計** | | **3 天** |

---

## 10. 待 user 確認

- [ ] **Plan GO**：以上設計可以動工？
- [ ] **Stage 1 規則範圍**：5 條基本規則（含中英空格）就夠，還是要加 6-10 進階規則？
- [ ] **Stage 2 降級範圍**：只做「sherpa→whisper」單向降級，還是雙向都可（whisper→sherpa 修復後自動切回）？
- [ ] **Stage 3 TTS 測試**：做 in-app TTS 測試按鈕（用 Web Speech API），還是 P3 不做測試、留 P4？
- [ ] **scope 邊界**：3 stage 全部都做？還是要砍？
