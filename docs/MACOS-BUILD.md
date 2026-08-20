# macOS Build Guide for Speak2T

> **狀態**: P4 Stage 3 — 設定準備完成（無 Mac 環境實測）
> **最後更新**: 2026-08-20

Speak2T 程式碼已具備 macOS 打包能力（`package.json` 已有 `build.mac` 設定），但本倉庫作者在 Windows 環境，無 Mac 設備實測。本文件提供 Mac 用戶完整的 build SOP。

---

## 1. 環境需求

| 工具 | 最低版本 | 用途 |
|------|----------|------|
| macOS | 11.0 (Big Sur) | Apple Silicon (M1/M2) 或 Intel |
| Xcode Command Line Tools | 最新 | git / make / 編譯 native modules |
| Node.js | 20+ LTS | 執行 electron / build script |
| npm | 10+ | 安裝依賴 |
| Homebrew | 最新 | 安裝額外工具（可選） |

### 1.1 必要安裝

```bash
# 安裝 Xcode Command Line Tools
xcode-select --install

# 安裝 Node.js (用 nvm 或 Homebrew)
brew install node@20
# 或 nvm:
nvm install 20
nvm use 20

# clone 專案
git clone https://github.com/galaxy-luke/speak2t.git
cd speak2t
npm install --legacy-peer-deps
```

---

## 2. Build 流程

### 2.1 開發模式（先試跑）

```bash
npm run dev
```

會啟動 Electron 視窗 + Vite HMR。檢查：
- [ ] 應用程式啟動（tray 圖示出現）
- [ ] 設定視窗可開啟
- [ ] 麥克風權限彈窗出現（首次啟動時）

### 2.2 打包 DMG

```bash
# 同時 build 給 Intel + Apple Silicon
npm run build:mac

# 或分開 build
npm run build:mac:x64    # Intel
npm run build:mac:arm64  # Apple Silicon（M1/M2）
```

產出 `release/Speak2T-0.1.0-x64.dmg` 與 `release/Speak2T-0.1.0-arm64.dmg`。

### 2.3 Universal Build（單一 DMG 支援 Intel + ARM）

```bash
npm run build:mac:universal
```

產出 `release/Speak2T-0.1.0-universal.dmg`（檔案較大，~400MB）。

---

## 3. macOS 特定設定檢查清單

### 3.1 Info.plist（`package.json` build.mac）

已設定：

- ✅ `category: "public.app-category.productivity"`
- ✅ `icon: "assets/icon-square.png"`
- ✅ `target: "dmg"`
- ✅ `artifactName: "Speak2T-${version}-${arch}.${ext}"`

需手動加（建議 user 補上）：

```json
"mac": {
  "category": "public.app-category.productivity",
  "icon": "assets/icon-square.png",
  "category": "public.app-category.productivity",
  "extendInfo": {
    "NSMicrophoneUsageDescription": "Speak2T 需要麥克風權限來接收您的語音並轉成文字",
    "LSApplicationCategoryType": "public.app-category.productivity"
  },
  "target": "dmg"
}
```

- `NSMicrophoneUsageDescription`：macOS 14+ 強制要求，否則麥克風權限彈窗不會出現
- 沒設定會導致 `getUserMedia` 直接 reject

### 3.2 程式碼層面（已處理）

- ✅ `app.setLoginItemSettings` 在 mac 用 LaunchAgent（Electron 內建處理）
- ✅ `tray.ts` 處理 mac 的 `app.dock` 行為
- ⚠️ **mac 文字注入需要「輔助使用」權限**（P2 已用 `clipboard` 注入，不需要權限）
- ⚠️ 麥克風權限要在首次使用時請求（mac 14+ 必須）

### 3.3 已知 macOS 限制

- **沒 code signing**：mac 13+ 預設會拒絕未簽章 app（Gatekeeper）
- **沒 notarization**：mac 13+ 要求公證，否則下載後首次開啟會被擋
- **沒 entitlement**：沙盒模式未啟用（不需要，因為沒上 Mac App Store）

---

## 4. 解決 Gatekeeper 問題（沒簽章）

### 4.1 開發者測試

```bash
# 移除 quarantine attribute（單次）
xattr -d com.apple.quarantine /Applications/Speak2T.app

# 或全域允許
sudo spctl --master-disable
```

### 4.2 正式發布

需要：
1. **Apple Developer ID** ($99/year)
2. **Developer ID Application** 憑證
3. **Xcode** 或 `codesign` CLI 簽章
4. **notarytool** 公證

```bash
# 簽章
codesign --deep --force --options=runtime \
  --sign "Developer ID Application: Your Name (TEAMID)" \
  /path/to/Speak2T.app

# 公證
xcrun notarytool submit Speak2T-0.1.0.dmg \
  --apple-id "your@email.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"

# Staple
xcrun stapler staple Speak2T-0.1.0.dmg
```

---

## 5. 自動更新（mac）

與 Windows 相同：透過 electron-updater 從 GitHub Releases 拉新版。

但需注意：
- 沒 code signing 的 app，sparkle (mac 的 update 機制) 會警告
- 建議：mac 用戶也用 Apple Developer ID 簽章

---

## 6. 完整發布 SOP

### 6.1 第一次發版（v0.1.0 → v0.1.1）

1. **更新版本號**：
   ```json
   "version": "0.1.1"
   ```

2. **建立 git tag**：
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. **設定 GH_TOKEN 環境變數**：
   ```bash
   export GH_TOKEN=ghp_xxxxxxxxxxxx
   ```

4. **Build + 自動 publish 到 GitHub Releases**：
   ```bash
   npm run build:win
   npm run build:mac
   ```

5. **到 GitHub Releases 頁面**：
   - 確認 `Speak2T-Setup-0.1.1.exe` 已上傳
   - 確認 `Speak2T-0.1.1-x64.dmg` / `arm64.dmg` 已上傳
   - 確認 `latest.yml` / `latest-mac.yml` 已上傳（electron-updater 讀這個）

6. **編輯 Release Notes**（在 GitHub UI 上）

### 6.2 第二次以後發版

1. 改版本號
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. `npm run build:win && npm run build:mac`
4. 完（auto publish）

---

## 7. 故障排除

### 7.1 `getUserMedia` 直接失敗

**症狀**：在 mac 上點「開始」沒反應
**原因**：沒設 `NSMicrophoneUsageDescription`
**解決**：參考 §3.1 加進 `package.json` `build.mac.extendInfo`

### 7.2 應用程式無法開啟（Gatekeeper）

**症狀**：「Speak2T.app 已損毀，無法開啟」
**原因**：沒 code signing 或被 quarantine
**解決**：
```bash
xattr -d com.apple.quarantine /Applications/Speak2T.app
```

### 7.3 Tray icon 看不到

**症狀**：啟動後 tray 沒圖示
**原因**：mac dock 不會自動顯示，需檢查 menubar 右上角
**檢查**：
- `tray.ts` 用了 `assets/tray-icon.png`
- macOS 13+ 對 tray icon 大小有限制（18x18 to 36x36）

### 7.4 文字注入失敗

**症狀**：P2 stage 3 開「自動啟動」後，文字注入到剪貼簿但不貼
**原因**：mac 上「PowerShell SendKeys」不適用，要用 `osascript`
**現狀**：P2 簡化只做 `clipboard`（手動 Ctrl+V），mac 也支援

### 7.5 ASR 引擎載入失敗

**症狀**：log 顯示「sherpa-onnx: modelDir not specified」
**原因**：模型下載在 Mac 失敗（網路 / 路徑問題）
**解決**：
- 確認 `%APPDATA%/speak2t/models/`（mac 是 `~/Library/Application Support/speak2t/models/`）
- 重跑 `npm run download-model sherpa-zh-en`（mac 終端機）

---

## 8. 開發 vs 打包差異

| 項目 | dev 模式 | packaged app |
|------|----------|--------------|
| Tray 圖示 | 從 cwd 讀 `assets/tray-icon.png` | 從 `process.resourcesPath` 讀（electron-builder 處理） |
| 自動更新檢查 | 跳過（`app.isPackaged = false`） | 從 GitHub Releases 檢查 |
| 模型下載 | 用 `app.getPath('userData')` | 相同（electron 處理） |
| 設定檔位置 | `<userData>/settings.json` | 相同 |

---

## 9. 已知未處理

- ❌ macOS code signing（需 Apple Developer ID）
- ❌ macOS notarization（需 Apple Developer ID）
- ❌ Universal binary optimization（單獨 stage，目前 universal 已可 build）
- ❌ 沙盒化（暫不需要，無 Mac App Store 計畫）
- ❌ ARM native binary 優化（sherpa-onnx-arm64 已有）

---

## 10. 聯絡 / 回饋

如果在 Mac 上 build 有問題：
- GitHub Issues: https://github.com/galaxy-luke/speak2t/issues
- 提 issue 時附：
  - `npm run build:mac` 完整 log
  - macOS 版本
  - Node.js 版本
  - 硬體（Intel / Apple Silicon）
