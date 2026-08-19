# AGENTS.md

> 給所有 AI coding agent 看的 Speak2T 專案說明。任何 agent 接手前必讀。

## 專案簡介

**Speak2T** — 為台灣繁體中文使用者打造的桌面語音輸入工具。

- 桌面常駐（system tray）、全域快捷鍵觸發
- 本機語音辨識（sherpa-onnx，無雲端依賴、隱私優先）
- 辨識後直接寫入當前焦點視窗游標處
- 目標平台：Windows 11 優先，後續 macOS

完整規劃書：`./SPEC.md`（**source of truth**）

---

## 快速指令

```powershell
# 安裝依賴
npm install

# 開發模式（會打開 Electron 視窗 + Vite HMR）
npm run dev

# 型別檢查
npm run typecheck

# Lint
npm run lint

# 打包 Windows 安裝檔（產出在 dist/）
npm run build:win

# 打包所有平台
npm run build
```

> ⚠️ 推送：`git push` 由 user 手動處理。agent 不主動 push（依 user 紀律）。

---

## 技術棧

| 層 | 選擇 | 版本 |
|----|------|------|
| Runtime | Node.js | 20+ LTS（已驗 24.7） |
| Framework | Electron | 30+ |
| 語言 | TypeScript | 5.x，strict mode |
| UI | React | 18 |
| 建置 | Vite | 5 |
| 打包 | electron-builder | 24 |
| ASR | sherpa-onnx | latest（k2-fsa） |
| 注入 | @nut-tree/nut-js | latest |
| 測試 | Vitest | latest |
| Lint | ESLint + Prettier | latest |

---

## 模組結構（per-function 垂直切分）

```
src/
├── main/                      # Electron main 進程
│   ├── index.ts              # 入口（極簡，只做 wiring）
│   ├── app-state.ts          # 全域狀態
│   └── tray/                 # 系統匣
├── functions/                 # per-function 業務邏輯
│   ├── hotkey/               # 全域快捷鍵 + 錄音狀態機
│   ├── audio/                # 音訊擷取、麥克風列舉、音量
│   ├── asr/                  # ASR 引擎抽象 + sherpa-onnx 實作
│   ├── injector/             # 文字注入（剪貼簿/按鍵）
│   ├── indicator/            # 錄音指示器浮窗
│   └── settings/             # 設定持久化
├── renderer/                  # React UI
│   ├── settings/             # 設定主視窗
│   └── indicator/            # 浮窗 UI（音量動畫）
├── preload/                   # preload scripts
└── shared/                    # 共用型別 / IPC contract
```

---

## 開發紀律（依 user 偏好）

1. **Plan-then-Build**：非 trivial 實作前必須有 plan + user GO
2. **Security First**：永遠第一位，零信任。不可為了簡化犧牲安全
3. **Completeness 完整性**：不可為了精簡犧牲完整性
4. **Simplicity 程式精簡**：是手段不是目標
5. **Automation Gate**：自動化流程必須系統化審查
6. **看程式再動手**：重大 refactor 前先讀 main.py / __init__.py / 最複雜 service
7. **規格書是 source of truth**：refactor 必須對齊 SPEC.md
8. **不在 spec 內的東西不主動加**：避免 scope 漂移

---

## 階段計畫

- **P0 雛形**（3-5 天）：基本骨架 + hello-world（熱鍵 → toast）
- **P1 基礎 UX**（3-5 天）：全域快捷鍵、兩種模式、指示器浮窗、文字注入
- **P2 設定 UI**（3-4 天）：設定主視窗、模型管理、麥克風選擇
- **P3 繁中優化**（2-3 天）：標點修正、繁中測試
- **P4 打包**（3-5 天）：electron-builder 打包 Windows installer、auto-update
- **P5 進階**（可選）：多段歷史、CLI 模式

目前進度：**P0**

---

## Git 規範

- 主分支：`main`
- Commit message：Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` / `test:`）
- Commit 前先檢查 `git status` 確保 staged 乾淨（user 紀律）
- Push：user 手動，agent 不主動 push

---

## 參考文件

- 規劃書：`./SPEC.md`
- License：`./LICENSE`（MIT）
- README：`./README.md`
- TROUBLESHOOTING（待 P1 建）
