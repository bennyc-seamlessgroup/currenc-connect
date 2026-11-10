# Currenc Connect — 專案背景與接手指引

最後整理：2026-11-10（香港時間）。這份文件用於讓新的 Codex 工作階段接續開發，無須使用者重述整個平台概念。實際檔案、測試結果及使用者最新指示優先於本文件的歷史描述。

## 最新指示（2026-11-10，本機英文改版）

- 最新主圖已改為使用者確認、修正握手機手勢後的扁平插畫：股東保留持倉，另外收到降落傘代幣獎勵，以加號表達額外獎勵。不得再用股份直接指向代幣的轉換箭嘴，亦不使用房屋／公司大樓代表持股。現用 `src/assets/landing/shareholder-rewards.png`，1122 × 1402、透明 PNG、沒有文字；保持 alpha、完整 contain，外層不可加底色或改成 JPEG。圖片及生成描述見同目錄 README。
- Current campaigns 移除搜尋欄及過濾；以橫向卡片列呈現，原生滑動、鍵盤及左右按鈕，只有溢出時顯示按鈕，頭尾停用；不要重新加入搜尋欄。五張合成活動的桌面／390px 原生瀏覽器滑動及末端詳情檢查通過，77 項測試保留通過。卡片版本 `b905f4b` 已在 Vercel Ready；既有正式資料沒有改動。
- 使用者最新要求移除網站 Sandbox／Preview 展示文字及標籤，並加入新生成主圖及登入前公開活動。不要重新加入全域示範標籤；KYC／持股／錢包／發放的實際功能未變，保留動作內準確說明，不可把模擬說成真實驗證或鏈上交易。
- 新增 `/api/public-campaigns`／`server/public-campaigns.mjs`：匿名唯讀、no-store、無帳戶建立，只回傳 active + listed 公司的 published + visible + 未過領取期限活動。嚴格 allowlist 公司品牌及活動條款；不能回傳整份 workspace、股東／錢包／資金／交易／聯絡／文件／成員／內部備註。活動以橫向卡片展示，`?campaign=` 只作導覽，登入及首次 onboarding 後接回活動並由受保護回應再檢查權限。77 項測試及桌面／390px 本機完整銜接檢查通過，正式資料未重設。
- 網站未登入入口已改為 `src/landing-ui.js` 的英文服務介紹，說明按真實持股及公司活動規則獲配代幣空投；Get started／Sign in 才開啟現有 OTP 登入。保持簡潔、沒有虛構客戶／回報／持股數字，且明示 Sandbox 驗證及發放仍為模擬。邀請電郵參數保留，登出回介紹頁，過期 session 清空私人資料再要求登入。72 項測試及桌面／390px 本機瀏覽器檢查通過；本機 QA OTP 是測試替身，不能聲稱重新驗證真實電郵投遞。
- 公開活動版本 `5ae86aa` 已在 Vercel Ready，77 項測試及建置檢查通過；線上匿名 API、現有公開活動搜尋／詳情／登入銜接、主圖及 390px 版面驗證完成。這輪沒有寄出正式 OTP，亦沒有更改現有公司／活動／帳戶／權限／資金。獨立 QA 程式停止，主 localhost:5173 保留運行。
- 活動管理版本 `92f9407` 已在 Vercel Ready，當時 71 項測試、建置及檢查通過。線上已實測合成帳戶邀請建立／撤銷，以及私密 Portal Review QA 公司中的活動建立／編輯／刪除／還原／開放／封存及重載保存；該測試活動保持 Archived，沒有登記、資金或轉帳。已核對公司成員移除入口、設定說明、股東首頁及三條鏈圖示，原有帳戶和 Viewer 權限保留。
- 新增 `drizzle/0003_account_lifecycle.sql`：平台 Accounts 可新增登入邀請、撤銷邀請、Remove portal access／Removed → Restore access。身份必須由驗證電郵首次登入建立；不能直接製造 Neon 用戶或自動授予平台／公司權限。邀請七天有效，只 Copy link，不會自動寄信；一般股東仍可自行註冊帳戶。移除是可還原的 `cc_account_controls.archived=1`，不刪除身份／個人／公司／交易資料；所有權限檢查須包含 archived，且撤銷同電郵待接受公司邀請。平台管理員須先撤銷平台角色，Owner／自身不可移除。
- `src/portal-ui.js` 提供帳戶管理、ⓘ hover/focus／點按說明及股東首頁簡介。股東登記開關只影響新活動持股登記，不影響帳戶登入及已有領取；公告為登入後工作空間頁面頂部純文字，可清空移除。
- ETH／SOL／BNB 圖示使用 `src/assets/chains/` 官方原始 SVG，來源見該目錄 README；建置成 img data URL，不改色／路徑，不依賴外部圖片請求。勿重新用文字符號或 AI 生成圖取代官方標誌。
- 本輪加入 `src/campaign-ui.js` 及按階段活動編輯：Draft 全部設定；Open 只名稱／說明及延長登記／領取期限；快照鎖定／暫停只說明。`registrationDeadline`、`claimDeadline` 分開，舊活動沿用 `deadline` fallback，不可靜默更改舊條款。發布後規則不可改、期限不可縮短，鎖定後解鎖比例只能增加。
- Delete draft 是可還原的 `deleted` 狀態，不實際刪除資料，僅限無登記／交易的草稿。Archive 保留全部配額／交易／餘額，未結清獎勵或 Open 活動已有登記時不能封存。Archived 唯讀；Deleted 只可 Restore draft。Owner/Admin 可刪除／還原／封存，Operator 只可按階段編輯；revision 及不可截斷的團隊／平台稽核須一併檢查。
- 平台公司管理的 Company access 加入 Remove、角色變更 stale-role 檢查及 Pending invitations → Revoke；Owner／自身不能移除。委任／移除時撤銷該公司同電郵舊待接受邀請，避免重獲權限。只撤銷該公司成員權限，保留帳戶、個人股東及其他公司資料。不要對現有測試 Viewer 成員做破壞性實測。
- 最新產品決定：**公司只由平台團隊建立及輸入資料**。一般帳戶沒有公司登記、申請、提交、補件或審批流程；`create-organization`／`save-company-application`／`submit-company-application` 均回覆 403，不能只隱藏按鈕。
- 平台入口：Platform console → Companies → Add company；`platform-create-company`、`platform-save-company` 僅允許 Platform Owner/Admin。新公司 active + hidden、空資金及空活動。法律／聯絡資料可由團隊逐步填寫，毋須證明文件或申請快照。公司名／ticker 可編輯，token 建立後固定；更新須保留所有業務資料並檢查公司及狀態 revision。
- 狀態資料表保留舊值以免破壞歷史：approved 顯示 Active，draft/pending/needs_info/rejected 顯示 Inactive，suspended 顯示 Suspended。後台只有 activate/deactivate/suspend/resume/show/hide，沒有 approve/reject/request-info。舊三間示範公司保留 hidden/inactive，不會自動啟用。恢復公司一律 hidden。
- 公司 Owner/Admin 與 Platform Owner/Admin 分開；公司成員不能更改平台保存的公司登記資訊。`companyApplication` 不再回傳予公司模式。舊文件／申請紀錄保留，內部文件只供平台人員讀寫，不再准許普通公司 Owner/Admin 存取；不要公開檔案或把內容放入工作空間 JSON／localStorage／稽核。
- 平台首位主管理員已經由使用者確認並初始化。`PLATFORM_BOOTSTRAP_OWNER_EMAIL` 及驗證 Neon issuer 只初始化一次，固定綁定 account ID；不可從公司 Owner、第一位用戶或客戶端欄位取得平台權限。真實管理員電郵不寫入 Git。localhost 的明確 local-development 例外不可公開部署。
- 平台保留帳戶／公司／活動控制、股東登記開關、公告及稽核紀錄。不得重設既有配額、發放、餘額、成員、原 JSON archive、舊文件或歷史申請。登入與權限真實，KYC／持股／錢包與發放仍為 Sandbox。
- 團隊版本已通過 57 項測試及線上 Postgres 新增／編輯／重載／停用／稽核實測；普通成員 Settings 已無登記入口。獨立測試庫 `/private/tmp/currenc-staff-company-qa.sqlite`，390px 無橫向溢出；QA 程式已停止，主 localhost:5173 保留運行。

- 公司與股東權限已改用 `server/platform.mjs`：Owner／Admin／Operator／Viewer，股東只見自己的身份、登記、錢包與獎勵。公司角色必須由建立公司或接受電郵綁定邀請取得；前端切換不能授予權限。
- `drizzle/0001_platform.sql` 是新增的帳戶、公司、成員、邀請與團隊稽核資料表；Neon 與 localhost SQLite 使用相同平台規則。業務狀態仍以每公司 JSON + revision 保存，並非已完成所有正式產品的資料模型。
- 新帳戶沒有示範公司或他人的股東資料。舊個人示範空間會一次性、原子匯入獨立公司並保留原 JSON 作 archive；不要重新匯入、清除或覆蓋。舊活動沒有公司 ID，僅保留在原擁有者的個人活動，避免洩露予其他公司的成員。
- 團隊邀請有效 7 天、可撤銷，必須以指定的已驗證電郵登入接受。現時使用 Copy link 由使用者自行分享，不會自動寄電郵；不要顯示為已寄出。Owner 才可任命／管理 Admin；Admin 只可管理 Operator／Viewer。Owner 不可被移除／降級，不可修改自己的成員權限。
- 帳戶登入及公司權限是真實存取控制；KYC、持股、錢包及發放仍為 Sandbox，亦未驗證公司代表資格或實作雙人資金審批。
- 目前 43 項測試通過；已在線上用兩個獨立電郵實測 Owner 邀請 Viewer、接受邀請、唯讀公司資料、私人獎勵隔離及角色儲存稽核。測試 Viewer 成員保留；本輪沒有新增測試資金。

- 保留 **localhost**：`npm run dev` → `http://localhost:5173`。使用者後續已明確要求修復 Vercel 部署，可將修正推送 GitHub 觸發 Vercel 部署；不要另建或部署 Sites。
- 網站介面使用英文；中文將來才加入語言選項。對話語言仍沿用以下溝通規則。
- 維持簡潔介面，移除宣傳大圖、口號及重複細字說明；操作相關說明放在對話框及 Quick guide。
- GitHub repo：`https://github.com/bennyc-seamlessgroup/currenc-connect.git`。Vercel 現有 `vercel.json`、`api/workspace.js` 及 Neon 資料庫適配；須在 Vercel 連接資料庫並提供 `DATABASE_URL` 或 `POSTGRES_URL`。線上版現使用 Neon Auth 電郵驗證碼登入，以 provider user ID 綁定工作空間；不同瀏覽器／裝置登入同一帳戶會取同一份資料。
- `scripts/run.mjs` 會選用合適的已安裝 Node；`scripts/local-server.mjs` 提供 SQLite 本機適配。
- 預設 build 不再生成離線 HTML；有需要才執行 `npm run build:offline`。
- Vercel 正式網址：`https://currenc-connect.vercel.app`；Neon 免費資料庫已接駁。登入改版已有 31 項測試通過；之前已驗證線上模擬領取及併發保護。帳戶登入是真實電郵驗證，但 KYC、持股及發放仍為 Sandbox。
- 首次帳戶登入會在帳戶尚無資料時原子接續現有瀏覽器示範空間，不覆蓋已有帳戶資料；不要按電郵或客戶端提交 ID 選擇工作空間。
- 勿重設 `.local/workspace.sqlite`；舊版已知示範文案只在顯示層轉為英文。

## 1. 溝通與工作方式

- 使用者為 Benny；除非明確要求其他語言，一律以繁體中文回覆，可用自然香港廣東話語氣。
- 工作回覆簡潔專業；長內容以重點、清單或表格呈現。
- 延續既有實作，不要在未檢查專案前另起爐灶或重建整個平台。
- 使用者已接受平台概念，名稱確定為 **Currenc Connect**，屬於 CURRENC 的新服務平台。
- 將正式產品目標與目前模擬功能清楚區分，不要把模擬通過說成已驗證真實身份、持股或鏈上交易。

## 2. 平台要解決甚麼問題

企業透過平台管理及發放自己的加密代幣，作為股東獎勵。股東驗證身份與持股後，按公司設定的持股比例或獎池規則獲配代幣，再透過加密錢包接收。

核心流程：**股東身份 → 持股證明 → 活動資格 → 配額計算 → 解鎖／發放 → 紀錄與對帳**。

這是多公司平台，並非只供 CURR 自己使用。每間公司應有獨立品牌頁、活動、股東名單、代幣設定與資金管理。

## 3. 使用者已確認的核心需求

### 股東端

1. 選擇自己持有股份的公司及獎勵活動。
2. 登記並填寫 KYC 表格。
3. 授權第三方 API，驗證是否為該公司股東及實際持股數量。
4. 根據公司規則判定資格，計算與持股相對應的代幣配額。
5. 選擇支援鏈、綁定接收錢包並接收代幣。
6. 查看獲配總額、可領取、未解鎖、已領取及交易紀錄。

### 公司端

1. 建立及管理股東代幣獎勵活動。
2. 設定分配方法、資格條件、最低持股、個人上限及總預算。
3. 設定基準日、登記／領取截止日、支援網絡、發放及解鎖方式。
4. 審核異常及人工持股證明，確認股東資格名單與快照。
5. 由股東自行領取，或由公司批次派發。
6. 管理代幣餘額、查看發放進度、匯出紀錄並保留稽核軌跡。

### 必須支援的鏈

- Ethereum（ETH）
- Solana（SOL）
- BNB Smart Chain（BNB）

目前尚未接駁任何真實鏈或測試網，不能把上述要求誤稱為已完成鏈上整合。

## 4. 已接受的設計方向及重要規則

- KYC 身份驗證與持股驗證是兩個獨立環節。
- 許多股東透過券商間接持股，股份登記機構名冊未必涵蓋實益持有人；需要多渠道驗證。
- 持股驗證可評估：券商聚合 API、Transfer Agent／股份登記名冊、獲認可的代幣化股票紀錄，以及人工證明作補充。
- 曾研究 SnapTrade、Plaid Investments 及 Securitize 類服務；**尚未選定、簽約、取得 API 憑證或確認實際券商覆蓋**。
- 現時持倉資料不代表任意歷史日期的持倉證明。正式整合須核實資料日期、更新延遲、帳戶持有人匹配及指定日證據。
- 股東有一份統一活動配額，選擇其中一條支援鏈接收。跨鏈不能重複領取。
- 每條鏈資金獨立管理；多鏈支援不代表提供自動跨鏈橋。
- 固定比例：合資格股數 × 每股代幣比例。
- 固定獎池：個人合資格股數 ÷ 本輪已核實合資格持股總數 × 獎池。
- 分配數量與解鎖時間分開處理。分期解鎖不應重複分配或撤回已發放數量。
- 快照鎖定後停止新增登記，固定名單及配額；任何後續更正應有明確版本及稽核策略。
- 身份及持股證明保留鏈下，鏈上只放發放所需資料。
- 錢包地址格式檢查不等於控制權驗證；正式版本需要簽名與防重放機制。
- 企業權限、資金簽署、雙人審批、供應量及地區／法律／稅務安排需要正式服務設計。

## 5. 目前 MVP 已實作內容

本版是可互動的 **Sandbox MVP**，用於驗證產品流程。

- 公司／股東兩個入口，共用同一位使用者的示範工作空間。
- 3 間示範公司、獨立活動及各鏈測試資金帳本。
- 活動草稿、開放登記、待審核持股、預覽並鎖定快照。
- 固定比例／固定獎池、最低持股、個人上限、活動預算及領取截止日。
- 首期解鎖比例、後續手動提高累計解鎖比例、暫停／恢復發放。
- 股東自行領取或公司模擬批次派發。
- 模擬 KYC、券商 API／名冊／人工審核渠道。
- ETH／SOL／BNB 接收網絡選擇，錢包地址格式檢查。
- 已領取後禁止變更接收網絡，統一配額防止重複發放。
- 測試資金注入、餘額扣減、操作紀錄、模擬交易詳情、CSV 匯出。
- 通知、使用指南、示範資料重設及響應式介面。
- Worker API 的登入身份檢查、跨來源檢查、D1 revision 樂觀鎖與衝突重試。
- 本機 SQLite 持久化，以及可直接開啟的獨立離線 HTML 示範。

### 尚未實作／不可誤稱為已完成

- 真實 KYC 或證件驗證。
- 真實券商、Transfer Agent 或其他持股 API。
- 真實錢包連接、簽名及錢包控制權驗證。
- 智能合約部署、鏈上發放、Gas 支付、確認與鏈上對帳。
- 企業 SSO、公司代表資格驗證、自動寄出邀請電郵或雙人審批。基本公司成員角色及連結邀請見上方最新指示。
- 自動週期快照、連續持有期驗證或自動線性解鎖。

本輪需求以股東代幣獎勵與發放為核心；不要自動混入另一個 CURR Hub 專案的代幣交易、信用卡購買等需求。

### 示範資料與計算細節

- CURRENC Group／CURR 為真實品牌示範；所有活動及持股數據均為測試。
- Northstar Labs／NRTH、Harbor Energy／HBR 為虛構示範公司。
- uCURR、NOVA、HBR 在目前介面僅為測試帳本代幣，沒有資產價值。
- `SIM-` 開頭的紀錄 ID 不是鏈上交易雜湊。
- 每次代幣計算向下取至 6 位小數；個人上限或取整剩餘不再分配。
- 日期欄位採 UTC，操作紀錄以香港時間顯示。
- 分期釋放目前由公司手動提高累計百分比。

## 6. 現有技術架構

- Node.js **22.13 或以上**；`npm ci` 安裝已鎖定的 Neon database／Auth SDK。
- 前端：原生 JavaScript、HTML、CSS；保留既有架構，除非後續需求確有遷移理由。
- 共用業務規則：TypeScript，建置時使用 Node 的型別移除功能。
- Hosted：Vercel + Neon Postgres + Neon Auth；原 Cloudflare Worker + D1 示範保留但未部署。
- 本機：Node HTTP server + SQLite，僅監聽 `127.0.0.1`。
- 離線示範：單一 HTML，資料存在當前瀏覽器，不會跨裝置同步。
- 目前資料以每位使用者一份 JSON 狀態及 revision 保存，並非正式產品資料庫模型。

| 檔案 | 用途 |
| --- | --- |
| `lib/domain.ts` | 資料型別、示範資料、活動狀態、配額及發放規則 |
| `src/app.js` | 前端頁面、對話框、表格、表單及互動 |
| `src/styles.css` | 響應式介面與視覺樣式 |
| `src/index.html` | 網頁入口 |
| `src/worker.js` | API、身份檢查、D1 儲存及 revision 鎖 |
| `drizzle/0000_workspace.sql` | 初始資料表 migration |
| `scripts/build.mjs` | 建置 Worker 與離線 HTML |
| `scripts/dev.mjs` | 本機伺服器與 SQLite 相容介面 |
| `scripts/validate.mjs` | Worker 及資源檢查 |
| `tests/` | 業務、API、併發及前端事件測試 |
| `README.md` | 啟動方式、範圍與操作指南 |
| `STATUS.md` | 目前進度及已知限制，接手時先讀 |

### 啟動與檢查

```sh
npm run dev
# http://127.0.0.1:5173

npm run build
npm test
npm run check
```

- Mac 可執行 `zsh Start.command`，會嘗試已安裝的 nvm Node 22／24。
- 本機資料：`.local/workspace.sqlite`。不要在接手時重設或刪除使用者已有資料。
- 離線示範：`outputs/Currenc_Connect_Offline.html`。
- Worker 輸出：`dist/server/index.js`；修改來源後重新建置，勿只修改生成檔。
- 正式登入身份須由可信任 gateway 注入。只有 loopback 開發程式會注入示範身份，不能直接將該身份模式公開部署。

## 7. 位置、驗證及部署狀態

根據接手文件整理時讀到的 `STATUS.md`：

- 專案目前已搬到 **`/Users/bennycheung/Desktop/Currenc Connect`**，原始 Git metadata 已保留。
- 舊 Documents 位置的副本已移走，不要再以舊位置作為開發主目錄。
- 上一輪 **13 項自動測試通過**，涵蓋資格、比例、獎池、分期、資金不足、跨鏈及併發防重複發放等。
- `STATUS.md` 記錄本機預覽已成功啟動，HTTP 200，總覽桌面版及 390px 手機版已作瀏覽器檢查；其餘頁面仍待逐頁視覺驗收。
- **尚未部署上線**。先前來源同步無法解析 `git.chatgpt-team.site`；私人 Site 已建立但沒有成功部署版本。
- 既有 Sites 專案 ID 保存在 `.openai/hosting.json`，應重用，不要重複建立。
- 此文件記錄的是既有驗證結果；新工作階段應檢查當前環境與修改後的實際結果，不要把歷史限制當成永遠無法執行。

## 8. 建議接手順序

1. 先讀 `README.md`、`STATUS.md`、`package.json` 及相關來源，確認桌面專案的最新狀態。
2. 根據使用者下一個要求繼續；無須再問平台是甚麼或重新命名。
3. 若要先驗收：啟動本機預覽，逐頁檢查桌面／手機版及完整角色切換流程。
4. 針對實際改動執行有關測試及建置，再更新操作或狀態文件。
5. 若進入正式整合，先確認供應商覆蓋、資料授權、身份權限與鏈上執行方式；不要將 stub 改成假成功。

### 完整示範流程

1. 股東端 → CURRENC Group → 股東啟航獎勵。
2. 使用 Demo Investor / demo@example.com 完成模擬 KYC，填寫 5,000 股。
3. 選擇接收鏈，儲存提供的示範地址。
4. 公司端 → 股東管理 → 批准 Iris 的待審核申請；如自己的登記選人工渠道，亦需批准。
5. 公司端 → 空投活動 → 預覽並鎖定股東啟航獎勵快照。
6. 股東端 → 我的獎勵 → 模擬領取 500 uCURR。
7. 公司端核對餘額、發放紀錄及匯出結果。
