# 口袋記帳本（Pocket Ledger）

個人用的 iPhone 記帳 App（PWA）。支援新台幣與美金，資料只存在手機裡，不上傳任何伺服器。

## 功能

- **快速記帳**：打開就是數字鍵盤，輸入金額 → 點分類 → 儲存。日期預設今天，備註可不填。
- **新台幣＋美金**：美金自動帶入當天匯率（可手動修改），匯率跟著每筆紀錄存下來。
- **月統計**：收入、支出、結餘（美金換算成台幣），支出分類圓餅圖，明細可點選修改或刪除；左右滑動切換月份。
- **分類管理**：可新增、改名、刪除；刪除的分類，舊紀錄仍保留原名稱。
- **備份**：匯出 CSV（Excel 可直接開）、從 CSV 匯入還原（重複的自動略過）；超過 30 天沒備份會提醒。
- **離線可用**、跟隨系統淺色／深色模式。

## 安裝到 iPhone

1. 用 **Safari** 打開 App 網址（GitHub Pages）。
2. 點下方的「分享」按鈕 →「加入主畫面」→「加入」。
3. 之後從主畫面的「記帳本」圖示開啟。

> 請一定要從主畫面圖示開啟，資料才會被系統保留；在一般 Safari 分頁裡用，資料可能被系統清掉。

## 備份提醒

資料只存在這支 iPhone 的這個 App 裡。**換手機、刪除 App 或清除 Safari 資料前，請先到「設定 → 匯出 CSV」**，把檔案存到「檔案」App 或雲端硬碟。新手機上用「從 CSV 匯入」即可還原。

## 開發

純 HTML／CSS／JavaScript，沒有任何套件、不需要編譯。

```bash
npm test          # 單元測試（Node 18+）
npm run serve     # 本機預覽 http://localhost:5173
npm run icons     # 重新產生 App 圖示
```

- `js/core.js`：金額、匯率換算、統計、CSV（純邏輯，有測試）
- `js/store.js`：本機儲存（localStorage）
- `js/app.js`：畫面
- `sw.js`：離線快取。**改了任何檔案要把 `VERSION` 加一**，iPhone 才會更新到新版（開啟兩次 App 後生效）。

匯率來源：[Rates By Exchange Rate API](https://www.exchangerate-api.com)（`open.er-api.com`，免費、免金鑰、每日更新）。
