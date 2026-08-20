# Speak2T P4 Plan — 打包 + 自動更新 + macOS

> **狀態**: 草稿 v0.1 — 等 user GO 才動工
> **日期**: 2026-08-20
> **範圍**: P0-P3 全部完成後的發布階段
> **源頭決策**: user 2026-08-20 選 (A)「進 P4」

---

## 1. 目標

把 Speak2T 從「source 跑」變成「可發布的桌面 App」：
- Windows 用戶可下載 NSIS installer 雙擊安裝
- 可選：自動更新（透過 electron-updater）
- 可選：macOS DMG 打包測試

### 1.1 P3 留下要做

| SPEC §6 P4 | 狀態 |
|------------|------|
| electron-builder 打包 Windows installer / portable | ❌ 未做 |
| 開機自動啟動（`app.setLoginItemSettings`） | ✅ **P2 Stage 3 已做**（v1.3 簡化為設定頁 toggle） |
| 自動更新（`electron-updater` 或省） | ❌ 未做 |
| macOS build 測試 | ❌ 未做 |

P4 簡化為 3 個真正要做的 stage。

### 1.2 非目標（Out of Scope）

明確不做：
- ❌ Microsoft Store / Snap Store 發布（spec 沒列）
- ❌ 程式碼簽章（Code Signing，需昂貴憑證，留 P5+）
- ❌ Auto-update server 架設（用 GitHub Releases 免費 hosting，但這要看 user 意願）
- ❌ 企業部署（MSI、Group Policy）
- ❌ Linux build（spec 沒列，環境也缺）

---

## 2. 範圍（3 個 stage）

| Stage | 名稱 | 工時 | 重要程度 |
|-------|------|------|----------|
| **1** | Windows 打包（NSIS installer + assets） | 1.5 天 | 高 |
| **2** | 自動更新（electron-updater + GitHub Releases） | 1 天 | 中 |
| **3** | macOS 打包測試（DMG + 必要修正） | 1 天 | 低（看 user 是否要 mac） |

**總計**：2-3.5 天

---

## 3. 設計原則

### 3.1 整體策略

- **electron-builder 為主**：已在 devDeps，package.json 已有 `build` 設定雛型
- **資產優先**：icon 是第一個 blocker（沒 icon.ico build 會失敗）
- **本地 model 處理**：模型下載在 runtime，不打包進 installer（避免 700MB+ installer）
- **零成本發布**：用 GitHub Releases hosting artifacts + auto-update feed（不花錢）
- **macOS 為可選**：user 在 Windows 環境，若不做 mac 可省 1 天

### 3.2 Windows 打包（Stage 1）

**必要資產**：

| 檔案 | 大小 | 用途 |
|------|------|------|
| `assets/icon.ico` | 256x256 多尺寸 | Windows installer / 應用程式 icon |
| `assets/icon.png` | 512x512 | Mac 通用（Stage 3） |

icon 設計：
- 簡單：🎙️ 麥克風圖示 + 「2T」文字
- 用 ImageMagick 或 SVG → PNG → ICO 流程
- 或是用 placeholder（256x256 透明 PNG）先把 build 跑通

**electron-builder 設定**（`package.json` `build` 區塊）：

```json
{
  "build": {
    "appId": "com.luke.speak2t",
    "productName": "Speak2T",
    "directories": {
      "output": "release",
      "buildResources": "assets"
    },
    "files": [
      "dist/**/*",
      "package.json"
    ],
    "extraResources": [
      // 模型不放這（runtime 下載）
    ],
    "asar": true,
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64"] }
      ],
      "icon": "assets/icon.ico",
      "artifactName": "Speak2T-Setup-${version}.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Speak2T"
    }
  }
}
```

**建置指令**：
- `npm run build:win`（已在 scripts）— 產 NSIS installer
- 預期產出：`release/Speak2T-Setup-0.1.0.exe`（約 150-200MB，不含模型）

**注意事項**：
- 第一次 build 會下載 electron 二進位（~200MB），需穩定網路
- build 失敗常見原因：icon 缺 / electron-builder cache 損壞 / Windows 缺少 nsis 工具（electron-builder 會自動下載）
- 完成後 smoke test：執行安裝檔 → 啟動 app → 確認基本功能

### 3.3 自動更新（Stage 2）

**工具選擇**：
- `electron-updater`（electron-builder 作者推的，與 NSIS 整合好）
- 或 `update-electron-app`（electron 官方，較簡單但客製化少）
- 選 `electron-updater`（社群主流，文件完整）

**架構**：
- GitHub Releases 當 update feed（`https://github.com/galaxy-luke/speak2t/releases`）
- 在 `package.json` `build.publish` 設定
- 發新版流程：tag → push → electron-builder 自動產 latest-*.yml → 發到 release
- App 啟動時檢查更新，下載並提示重啟

**實作步驟**：
1. `npm install electron-updater`
2. main process 加 update check（app.whenReady 後）
3. 加 IPC: `CHECK_UPDATE` / `APPLY_UPDATE` 給 settings UI 用
4. settings 進階 tab 加「檢查更新」按鈕 + 顯示當前版本
5. 設定 `GH_TOKEN` 環境變數給 build（publish 需 token）

**Trade-off**：
- 沒做：v0.1.0 永遠不檢查更新（需發 v0.1.1 才有用）
- 但程式碼先寫好，後續發版直接用

### 3.4 macOS 打包（Stage 3，可選）

**限制**：
- 需要 mac 環境才能 build（cross-compile 不行）
- 需要 Apple Developer ID 簽章（沒簽章的 DMG 會被 Gatekeeper 警告）
- 需要 code signing certificate（付費或免費的 ad-hoc）

**做法**：
- 若 user 有 Mac：可在 Mac 上 build 出 DMG
- 若 user 沒 Mac：stage 3 改為「設定準備 + 文檔」，實際 build 等 user 有 Mac 再做

**必要修正**：
- `app.setLoginItemSettings` 在 mac 行為不同（改用 LaunchAgent plist）
- 麥克風權限：mac 需在 Info.plist 加 `NSMicrophoneUsageDescription`
- 文字注入：mac 需在 System Settings 開「輔助使用」權限

**預期工時**：
- 純設定：0.5 天（即使不 build 也可改完）
- 完整 build + 測試：1 天（需 Mac 環境）

---

## 4. Stage 拆分

### Stage 1：Windows 打包（1.5 天）

**目標**：能跑出 `release/Speak2T-Setup-0.1.0.exe` 並安裝執行

**步驟**：
1. **建立 assets**：
   - `assets/icon.ico`（256x256 多尺寸 Windows icon）
   - `assets/icon.png`（512x512 通用）
   - `assets/installer-icon.bmp`（NSIS 用 164x314 BMP，可從 icon 生成）
2. **更新 `package.json` build config**：
   - `directories.buildResources: "assets"`
   - `artifactName` 模板
   - 確認所有 win/nsis 設定
3. **加 build scripts**：
   - `clean` script：rm -rf release
   - `build:win:dir` script：產出 unpacked directory（debug 用）
4. **第一次 build**：
   - `npm run build:win`
   - 修任何錯誤（icon 格式 / 缺檔 / 快取問題）
5. **驗證**：
   - 安裝 NSIS installer 到 Windows VM 或本機
   - 啟動 app，確認：tray 圖示 / 熱鍵 / 設定視窗 / 注入功能
6. **文件**：
   - README 加「安裝」段落
   - CHANGELOG 加 P4 Stage 1

**新增檔案**：
- `assets/icon.ico`（256x256，binary）
- `assets/icon.png`（512x512，binary）
- `assets/installer-icon.bmp`（164x314，binary）
- `scripts/generate-icons.mjs`（從 SVG 產 icon 的 helper，可選）

**修改檔案**：
- `package.json`（build 設定 + scripts）
- `README.md`（安裝段落）

### Stage 2：自動更新（1 天）

**目標**：app 啟動時檢查 GitHub Releases，有新版提示下載

**步驟**：
1. **裝 `electron-updater`**：`npm install electron-updater`
2. **main process 加 update check**：
   - `app.whenReady` 後呼叫 `checkForUpdates()`
   - 沒新版就 log，不打擾
   - 有新版就 IPC 廣播 + settings UI 顯示提示
3. **加 IPC + preload**：
   - `CHECK_UPDATE`（invoke）
   - `UPDATE_AVAILABLE`（broadcast）
   - `APPLY_UPDATE`（invoke，下載並重啟）
4. **settings UI**：
   - 進階 tab 加「檢查更新」按鈕
   - 顯示當前版本 + 最新版本
5. **build 設定**：
   - `package.json` build.publish.provider: "github"
   - `package.json` build.publish.owner: "galaxy-luke"
   - `package.json` build.publish.repo: "speak2t"
   - 設定 `GH_TOKEN` env（user 手動）
6. **驗證**：
   - local build 跑 `latest.yml` 檢查
   - 手動 publish 到 GitHub Releases 測試

**新增 IPC**：
- `IPC.CHECK_UPDATE: 'invoke:update:check'`
- `IPC.UPDATE_AVAILABLE: 'broadcast:update:available'`
- `IPC.UPDATE_DOWNLOADED: 'broadcast:update:downloaded'`
- `IPC.APPLY_UPDATE: 'invoke:update:apply'`

**修改檔案**：
- `package.json`（dependencies + build.publish）
- `src/main/index.ts`（update check 整合）
- `src/shared/ipc-channels.ts` + `src/shared/api.ts` + `src/preload/index.ts`
- `src/renderer/settings/tabs/AdvancedTab.tsx`（檢查更新按鈕）

### Stage 3：macOS 打包（可選，0.5-1 天）

**目標**：在 Mac 上能 build 出 DMG + 應用程式

**若 user 有 Mac**：
1. **修正 macOS 特定問題**：
   - `Info.plist` 加 `NSMicrophoneUsageDescription`（麥克風權限提示）
   - 應用程式 menu / dock 行為（mac 不像 Windows 有 system tray）
   - 自動啟動改用 LaunchAgent
2. **在 Mac 上 build**：
   - `npm run build:mac`（需新增 script）
   - 產出 `release/Speak2T-0.1.0.dmg`
3. **驗證**：
   - 開 DMG 安裝
   - 啟動 app、測試權限彈窗
   - 拍 screenshot 給 user 看

**若 user 沒 Mac**：
- Stage 3 改為「macOS 設定準備 + 文檔」（半小時）
- 加 `docs/MACOS-BUILD.md`：說明如何在 Mac 上 build
- 不實際 build

**修改檔案**：
- `package.json`（mac 設定 + build:mac script）
- `src/main/index.ts`（mac 特定 init）
- 可能加 `assets/Info.plist` 或用 electron-builder 的 plist 設定

---

## 5. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| icon 設計缺技能 | 高 | Stage 1 失敗 | 用簡單 placeholder（emoji → PNG → ICO），不糾結美術 |
| electron-builder 快取損壞 | 中 | build 失敗 | `npx electron-builder clean` 重試 |
| 第一次 build 慢（20-40 分鐘） | 高 | 浪費時間 | 預期告知，並行做其他事 |
| 沒 Mac 不能 build macOS | 高 | Stage 3 失敗 | Stage 3 改文檔，不實際 build |
| electron-updater 需 GH token | 中 | 自動更新壞掉 | 文件說明 + user 手動設 token |
| code signing 缺憑證 | 高 | 散布困難 | 不簽章 + 文檔說明；user 之後可加 |
| auto-update 發版流程沒測試 | 高 | 發新版壞掉 | Stage 2 文件化「發版 SOP」，但只測 1 次 |

---

## 6. 驗收標準

### 整體 P4 驗收

1. 跑 `npm run build:win` 產出 `release/Speak2T-Setup-0.1.0.exe`（約 150-200MB）
2. 下載並雙擊安裝
3. 啟動 app，確認基本功能：tray / 熱鍵 / 設定 / ASR
4. （有 Mac）跑 `npm run build:mac` 產出 `.dmg`
5. 進階 tab 出現「檢查更新」按鈕，點下去讀 GitHub Releases

### Stage 驗收

- **Stage 1**：NSIS installer 可裝可跑
- **Stage 2**：app 啟動時 log「check update」（沒新版就安靜）
- **Stage 3**：依 user 環境調整（有 Mac → 實際 build；沒 Mac → 文檔）

---

## 7. 已知限制（P4 之後再說）

- ❌ 沒 code signing，Windows 會有 SmartScreen 警告、mac 會有 Gatekeeper 警告
- ❌ 沒 CI/CD 自動 build（需 GitHub Actions 設定，留 P5+）
- ❌ 沒 portable 版本（可加 `target: portable`，半天）
- ❌ 沒 Linux build（spec 沒列）

---

## 8. 文件更新

- **CHANGELOG.md**：每個 stage 加 section
- **README.md**：加「安裝」段落（從 source 跑 / 從 installer 裝）
- **SPEC.md §6 P4**：checkbox 標 [x]
- **docs/MACOS-BUILD.md**（Stage 3 沒 Mac 時）：Mac 環境 build SOP

---

## 9. 預估時程

| Stage | 工作 | 預估 |
|-------|------|------|
| 1 | Windows 打包 | 1.5 天 |
| 2 | 自動更新 | 1 天 |
| 3 | macOS（依環境 0.5-1 天）| 0.5-1 天 |
| 文件 + commit | 全部 | 0.5 天 |
| **總計** | | **3.5-4 天** |

若 user 沒 Mac，總計 3 天。

---

## 10. 待 user 確認

- [ ] **Plan GO**：以上設計可以動工？
- [ ] **Stage 3 macOS**：user 有 Mac 嗎？（影響 0.5 vs 1 天）
- [ ] **icon 設計**：user 想要什麼風格？簡單 emoji placeholder（快）vs 自製 SVG 轉 ICO（品質好但要 0.5 天設計時間）
- [ ] **自動更新**（Stage 2）：v0.1.0 不會用到（要 v0.1.1 後才會檢查到新版），但先寫程式碼 OK 嗎？或 P4 不做 Stage 2，留 P5？
- [ ] **Scope 邊界**：3 stage 全做？或先做 Stage 1 驗證打包可行，Stage 2/3 之後再說？
