# Currenc Connect

A shareholder rewards platform with company workspaces, teams and individual investor accounts. English is the current interface language; Chinese selection will be added later.

Signed-out visitors first see a public service introduction explaining company token airdrops based on eligible shareholdings, an editorial hero image and a horizontal **Current campaigns** row. Only active, listed companies with published, visible and unexpired campaigns appear. **View campaign** shows public terms; **Sign in to continue** remembers the selected campaign through verified login and first shareholder onboarding. **Back to introduction** returns without losing invitation context. Signed-in accounts continue to their workspace.

The hero uses the user-approved transparent illustration of a shareholder **keeping their stock holdings and receiving additional token rewards**. The PNG is displayed in full on the page background; it has no embedded text or shares-to-token conversion arrow. Current campaigns has no search field: cards stay in one horizontal row, with native swipe/trackpad/keyboard scrolling and previous/next controls only when the row overflows. The controls disable at either end. A single card fits the phone viewport; multiple phone cards reveal part of the next card.

The read-only `/api/public-campaigns` endpoint requires no account and creates no identity. Its explicit projection excludes shareholder records, wallets, transactions, treasury, contacts, files, membership and internal moderation notes. Changes to listing and registration controls are reflected without a public cache. A `?campaign=...` link is navigation context, never authorization. The page no longer displays global Sandbox/Preview labels; action-level descriptions distinguish real access, wallet signatures and manual review from simulated KYC/broker checks and distributions. The approved vertical hero asset and generation prompt are recorded in `src/assets/landing/README.md`.

## Run locally

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. `http://127.0.0.1:5173` also works. On Mac, double-click `Start.command` or run `zsh Start.command`.

Node.js **22.13 or later** is required. If the default Node is older, the launcher can use a compatible version already installed through nvm. Run `npm ci` after cloning to install the pinned Neon, wallet signature and build dependencies. Local storage uses Node's built-in SQLite.

The local HTTP server stores data in `.local/workspace.sqlite`. Data survives browser reloads and server restarts. Localhost injects one explicit developer identity, which owns the existing sample companies. Company access rules and personal shareholder records use the same platform service as Vercel. The server listens on loopback only; never expose this developer identity on a public server.

To use another port:

```sh
PORT=5174 npm run dev
```

Stop with Ctrl+C. Source changes require restarting the server to rebuild the app. Existing local data is preserved. The previous offline HTML uses separate browser storage; it is not automatically imported into the local database.

## Company and shareholder access

New hosted accounts continue as shareholders or accept a team invitation. Company registration is handled exclusively by the platform team through **Platform console → Companies → Add company**. Company owners/admins cannot register more companies or submit an application. The retired create/save/submit application APIs reject all self-service calls.

Staff-created companies start active and hidden, with no campaigns, shareholders or test funds. Platform staff enter and maintain company information, appoint administrators and control whether the company is listed. Company names and tickers never grant access to an existing company.

| Role | Company access |
| --- | --- |
| Owner | All company actions; appoint administrators; manage other members |
| Admin | Campaigns, reviews, treasury and distributions; invite/manage operators and viewers |
| Operator | Campaigns, registration reviews, snapshots and unlock settings |
| Viewer | Read-only company data and exports |
| Shareholder | Published campaigns and only their own identity, holdings, receiving wallets and rewards |

The company owner cannot be removed or demoted. Members cannot change their own role. Company members share one company ledger, with revision checks for simultaneous writes. Shareholder identity is independent of company membership: an owner can also use their personal shareholder portal, but cannot claim another shareholder's allocation.

Open **Company → Team → Invite member**, enter an email and role, then use **Copy link**. Share this link yourself: **the app does not send an invitation email**. The recipient signs in with the invited email and accepts the invitation under **Invitations**. Links expire after seven days and can be revoked. A link alone never grants access. Accepted invitations cannot be replayed after membership removal. Role changes and removals apply on the next protected request; the UI clears inaccessible company data and returns to the shareholder portal.

Only published campaign settings appear in the shareholder directory. Company treasury, review queues, team details and other investors' records are excluded from shareholder responses. All write permissions are enforced server-side; changing a browser view or supplying another account/holder ID does not grant permission.

## Wallet list airdrops and custody setup

**Company → Campaigns → New campaign** offers **Wallet list airdrop** or the existing **Shareholder rewards** flow. The setup guide and campaign progress steps show the next action; form explanations are available through the information buttons.

For a wallet list airdrop:

1. Enter the campaign name, distribution purpose, existing token contract/mint, symbol, decimals, one network and requested release time in UTC.
2. Upload a UTF-8 CSV (maximum 1 MB / 5,000 wallets). Use `wallet_address,amount,reference`; `reference` is optional. Alternatively upload `wallet_address` (with optional `reference`) and enter **Amount per wallet**. If the CSV contains an amount column, every row must specify its own amount. Download template provides the per-row format.
3. Review the normalized addresses and exact token amounts. Invalid addresses, duplicate destinations, zero/negative amounts, scientific notation and excessive precision are rejected as a complete file; no partial import is saved. Import replaces the draft list. Clear the list before changing the network, token or decimals.
4. A company Owner/Admin chooses **Review & submit** and confirms authority and the destinations. Submission creates an immutable version and SHA-256 digest of the company, token, instructions and complete recipient list. Operators can prepare information and lists; Viewers can inspect permitted company records.
5. The platform team reviews it under **Platform console → Custody & releases**, then requests changes or approves the plan. Requested changes allow the company to revise and resubmit a new version. Earlier versions and audits remain intact. Submitted/approved lists cannot be edited; cancellation stops the request, and eligible records can be archived.

Recipients in this flow do **not** need KYC, a portal account, wallet connection or an ownership signature. Uploaded addresses are destination instructions from the company, not verified wallet ownership. Manager authentication and company permissions remain mandatory. These airdrops are private company records and never appear in public campaigns or shareholder discovery. They do not create shareholder registrations, claimable balances or simulation transactions.

**Custody & releases** also stores public custody-wallet configurations and company token-to-wallet assignments. Ethereum, BNB and Solana network identifiers are explicit, including separate test networks. Company views receive only their assigned token routes; a common master address never creates a balance for every company. Ordinary workspace responses contain campaign summaries, not recipient lists. Authorized detail responses paginate recipients in pages of 100.

**Current boundary:** custody signing, deposit verification, company-attributed balances/reservations and real token releases are not connected. The user will create the custody wallet next. A public address or approved plan does not verify funding, connect a signer or move tokens. Balances stay **Not reconciled**, released amounts stay zero, and the release action stays disabled. Do not send tokens until the selected custody provider, wallet and reconciliation/signing integration are completed. No private keys or seed phrases are collected or stored. Existing simulation balances and the separate Sepolia pilot are unchanged.

Company **Team**, pending invitation attribution and company activity now omit platform-internal account identities and use **Platform team** where attribution is needed. Actual memberships, protected ownership and detailed internal platform audits are preserved. Platform-role grants maintain a persistent internal-account marker so historical staff identities do not reappear after a role is revoked.

## Platform console and company management

Platform administrators are separate from company owners/admins. The **Platform console** contains Companies, Accounts, Custody & releases, Portal settings and Audit log. Company registration is staff-managed; the distribution review queue is separate from company registration.

1. Open **Companies → Add company** and enter its name, ticker and test token symbol.
2. Enter or edit legal, registration, jurisdiction, website, address and contact information; press **Save company information**. Additional registration details are optional and can be completed by the team over time. Supplied website/email fields are validated.
3. Use **List on portal** when ready. A company appears to shareholders only when it is active, listed and has a published, visible campaign.
4. Appoint an existing registered account under **Company access**, or use the company Team invitation flow.

Platform staff can deactivate/activate, suspend/restore, hide/list companies and moderate campaign visibility or payouts, with recorded reasons and revision checks. Activation does not require an applicant, uploaded evidence or a submission. Newly created companies and restored companies remain hidden until explicitly listed. Existing inactive companies retain that state until staff activate them. Existing allocations, balances, transactions, memberships and historical submission/file records are preserved. Editing a company name/ticker also updates its business metadata without replacing its ledger; the test token symbol is fixed after creation.

The previous application interface is retired. Historical private files remain available to platform staff under **Internal files**; ordinary company owners, admins, operators and viewers cannot read or upload these internal records. Files retain immutable versions, authenticated attachment downloads and `no-store`. No public file URLs or file bytes appear in business JSON. The bounded document API remains restricted to platform staff (PDF/PNG/JPEG, 2 MB per file, up to 20 retained versions), and no documents are required for company creation or activation.

Portal settings control new shareholder campaign registrations and a plain-text announcement. Account suspension, platform-role delegation, company administrator appointment and team invitations retain their previous server-side protections. Only the platform owner can appoint/remove platform admins; the platform owner cannot be demoted or suspended through the app. Platform review rights do not automatically confer company membership or access to company shareholder ledgers; a staff member who creates a company owns that new workspace.

### Editing, removing and retaining records

**Company access:** Platform console → Companies → Manage shows every company member's role. Platform staff can Change role or Remove a non-owner member, with a removal reason. Removing company access does not delete an account or its personal shareholder records. Owner/self-removal is protected. Role edits/removals check the displayed role to reject stale changes. Appointing an existing member must use Change role. Assignment/removal revokes outstanding invitation links for that company/email so old links cannot restore access. Pending company invitations can also be revoked directly from this screen. Every change is recorded in platform and team audit.

**Campaign lifecycle:**

| Stage | Available changes |
| --- | --- |
| Draft | Edit all settings. Owners/admins can move an unused draft to Deleted, then restore it. |
| Open registration | Edit name/description and extend registration/claim deadlines. Reward rules and eligibility stay locked. |
| Snapshot locked / paused | Edit description only; cumulative unlock can increase through the existing unlock action. |
| Archived | Read-only records. Archive is available after registered shareholders' rewards are settled. |
| Deleted | Read-only draft retained for audit; owners/admins can restore it unpublished. |

Registration and claim deadlines are now separate UTC dates. Existing campaigns fall back to their saved combined deadline until edited; no dates or reward rules are silently migrated. Registration stops at its own deadline. Snapshot locking and claims remain possible up to the claim deadline. The claim deadline cannot precede registration. Published deadlines cannot be shortened. Locked reward rules cannot be changed by forged API payloads. Campaign revisions reject stale edits, with company/team audit stored atomically alongside each lifecycle change.

Delete draft is reversible and only available without registration/distribution records. Published campaigns use Archive, which preserves all shareholders, allocations, treasury balances and transactions. Unsettled allocated rewards or open registrations block archiving. Archived/deleted campaigns leave public discovery and cannot be changed or revived by platform visibility controls. Operators may edit permitted fields; only company owners/admins delete/restore drafts or archive campaigns. Viewer access remains read-only.

Company name/ticker/contact details, company listing/status, account suspension and platform administrator access already have edit/revoke controls. Token symbols, company ownership, historical files, allocations and completed transactions retain their existing immutability; company/account access is suspended or revoked without destroying financial history.

### Portal accounts, explanations and first visit

**Accounts → Add account** creates a seven-day sign-in invitation, not an invented authentication identity. Share **Copy link** yourself; no invitation email is sent automatically. A recipient's first verified email sign-in creates the actual account and marks a matching valid invitation accepted. The link grants no company membership or platform administrator privilege. Normal shareholder sign-up remains available independently of invitations; revoking an invitation removes the invitation record, not the ability to sign up publicly.

**Disable all portal access** blocks every protected workspace/document request, including shareholder access, and moves the account to **Disabled**. **Restore portal access** re-enables the account and its retained company roles. To restore shareholder access only, first remove any company roles that should not return. **Revoke platform role** removes platform administration only; **Remove company access** removes only that company membership. Both preserve shareholder sign-in. One verified account can hold shareholder, multiple company and platform roles at the same time. Account records, provider identity, rewards, company ownership and audit history are retained. Removing access also revokes pending company invitation links for that email. Platform administrators must first lose their platform role; the platform owner and the acting administrator's own account remain protected. Disable/Restore is the single account-wide flow. Historical suspended accounts appear under Disabled and remain blocked until an explicit Restore; reads do not rewrite their stored status or reactivate them. Legacy account-status commands are compatibility aliases for the same disable/restore path and create no new suspended states. Disable continues to revoke pending company invitations; Restore does not recreate revoked invitations. Historical data and authentication identities are preserved.

**Accounts → Manage access** is the single action on each account row. It shows shareholder availability, platform role and all assigned company roles. Company roles can be edited or removed here using the existing server-authorized, stale-role-checked commands; the company owner and your own membership remain protected. The account list receives only company name, ID and role metadata for its displayed page, and only platform staff can access that projection. The single **Disable all portal access / Restore portal access** action is under **Account controls**, collapsed for active accounts and expanded for disabled accounts. Mobile account rows keep the Manage access action visible without horizontal scrolling. No roles are automatically granted or restored by opening these dialogs.

**Account search** covers login email, authentication display name, and completed identity-profile name, profile email and country/region. Profile name is used as the account's display name when available; the verified login email remains visible and is still the identifier used for access management. Expand **Identity profile** inside Manage access to see the self-reported fields and **Completed (demo)** status. These fields are not independently verified KYC. Uncompleted default country values are not treated as provided identity information. Search is staff-only, case-insensitive, escapes literal wildcard characters, and keeps the query when switching Current/Disabled or paging. Only the allowed profile fields are searched/projected; raw profile JSON, identity document numbers, files and provider secrets are not returned or searched. No new sensitive identity fields are collected.

The ⓘ controls explain account access, company roles/listing, campaign moderation, the announcement and campaign-registration setting. Hover/focus shows a tooltip on desktop; clicking opens the same readable explanation on keyboard/touch devices. **Portal announcement** is a plain-text notice at the top of signed-in workspace pages; clear the field to remove it. **Accept new shareholder campaign registrations** controls new holdings registrations in published campaigns, not new account creation or existing reward claims.

The shareholder Companies page now gives a short introduction and three steps: choose a company, add profile/holding details, then add a wallet and claim available rewards. Chain symbols use unchanged official Ethereum/Solana/BNB Chain SVG marks, embedded locally with no third-party image requests. Sources are recorded in `src/assets/chains/README.md`. KYC/broker checks and payouts remain simulated; wallet control is verified by signature.

### Initialize the platform owner

Set **`PLATFORM_BOOTSTRAP_OWNER_EMAIL`** in the Vercel project's **Production** environment to the intended operator's verified login email, then redeploy. Keep this deployment-controlled value server-side; do not commit a real operator email or add a client-exposed prefix. The trusted issuer is the configured Neon Auth service. The first matching verified account is bound as the sole platform owner **by its authenticated account ID**. There is no first-user, company-owner, request-header or self-service route to platform privileges. Later changes to the bootstrap email do not transfer ownership. Other platform admins are delegated by the initialized owner through Accounts.

Localhost explicitly bootstraps its loopback-only developer identity for review. This is development configuration, never a production fallback.

Existing sample companies remain intact and hidden/inactive until staff choose **Activate company**, then **List on portal**. This enables sandbox operations and does not assert real company, KYC or legal verification.

## Existing demo flow

1. Select **Shareholder**, then **CURRENC Group → View rewards → Register**.
2. Complete demo KYC with `Demo Investor / demo@example.com` and register 5,000 shares.
3. In the authenticated portal, connect and verify your own Ethereum, Solana or BNB Chain wallet, then select it as the campaign receiving wallet. The optional offline export retains its demo-address form.
4. An owner, admin or operator selects **Company → CURRENC Group → Shareholders** and approves Iris. Approve your own registration too if you chose manual statement review.
5. Open **Campaigns → Shareholder Welcome Rewards → Preview snapshot → Lock snapshot**.
6. Select **Shareholder → My rewards → View reward → Simulate claim** to claim 500 uCURR.
7. Return to the permitted company workspace to check Treasury, Distributions and CSV exports. This flow uses the preserved sample companies on localhost or an account migrated from the previous demo. New shareholders receive no sample investor records; a company must publish a campaign before it appears in their directory.

## Commands

```sh
npm run build          # Build the server app
npm test               # Domain, API, local persistence and UI tests
npm run check          # Validate built assets and hosting metadata
npm run build:offline  # Optional standalone HTML export
```

The optional offline export is `outputs/Currenc_Connect_Offline.html`. Normal development and `npm run build` do not regenerate it. Use localhost for the current version.

## Project structure

| File | Purpose |
| --- | --- |
| `lib/domain.ts` | Shared validation, demo data, allocations and distribution rules |
| `src/app.js` | English UI and interactions |
| `src/styles.css` | Responsive styles |
| `src/index.html` | Page entry |
| `src/worker.js` | Workspace API and optimistic concurrency control |
| `scripts/local-server.mjs` | Node HTTP and SQLite adapter |
| `scripts/dev.mjs` | Build and launch localhost |
| `scripts/run.mjs` | Select a compatible installed Node runtime |
| `scripts/build.mjs` | Build Vercel browser assets and Worker; optional offline export |
| `api/workspace.js` | Authenticated Vercel workspace API |
| `api/auth.js` | Email code sign-in, session check and sign-out |
| `server/` | Cloud database and sandbox session adapters |
| `server/platform.mjs` | Company memberships, invitations, tenant boundaries and shareholder projections |
| `server/governance.mjs` | Platform access, company applications, moderation, account controls and audit |
| `server/company-documents.mjs` | Bounded private evidence upload/download and version retention |
| `src/governance-ui.js` | Company application and platform console views, bundled with app.js |
| `server/sqlite-database.mjs` | SQLite transactions for loopback development and isolated tests |
| `vercel.json` | Vercel output and response headers |
| `drizzle/0000_workspace.sql` | Initial database schema |
| `drizzle/0001_platform.sql` | Accounts, organizations, memberships, invitations and team audit |
| `drizzle/0002_governance.sql` | Company review, private evidence, platform admins, portal and account controls |
| `tests/` | Domain, API, UI and localhost regression tests |

Known sample Chinese labels from earlier local data are displayed in English without resetting the database. User-authored campaign names and other content are retained.

## GitHub and future hosting

Repository: [bennyc-seamlessgroup/currenc-connect](https://github.com/bennyc-seamlessgroup/currenc-connect).

Vercel deployment is configured in `vercel.json`: the build command is `npm run build`, the framework preset is Other, and the output directory is `dist/client`. Node is pinned to 22.x. The build retains the separate Worker output for localhost and Sites.

The native `/api/workspace` function uses Neon Postgres through `@neondatabase/serverless`. The integration must supply `DATABASE_URL` or `POSTGRES_URL`; never commit either value. The adapter applies additive, idempotent schema creation in a transaction under a Postgres advisory lock. Accounts, memberships and invitations are relational records. Business state remains one revision-protected JSON document per company, so approvals, snapshots, allocations and ledger debits share the same optimistic lock.

The hosted app uses managed Neon Auth (Better Auth) with email verification codes. Open the app, enter your email and enter the 6-digit code from Neon. The same account loads its personal records and permitted company memberships across browsers and devices. Sign out from the sidebar. Login verifies email ownership; it does not verify KYC, shareholdings or company representation.

The API validates the provider session on every request and keys records by the provider user ID, never by a caller-supplied email or header. Auth tokens stay in secure HttpOnly cookies and are not returned to frontend JSON or stored in localStorage. Cached session cookies are excluded so provider revocation is checked immediately. The SDK-required cache signer is ephemeral because that cache is disabled; it does not sign or validate the actual provider session.

An existing browser demo can be atomically adopted only before account initialization. Existing account data is never overwritten with a different browser demo. On the account's first platform request, its previous sample companies are imported as separately owned organizations in one transaction; balances, campaigns, allocations, wallets, claims and revisions are retained. IDs are namespaced to avoid collisions between companies; original IDs are retained as `legacyId`. The old JSON row remains unchanged as a migration archive. Old activity lacks reliable company IDs, so it is retained in the original owner's personal activity rather than shared with newly invited company members. Local SQLite and offline data are not uploaded automatically.

Auth configuration lives in `server/auth-config.mjs` (a public service URL, not a credential), with optional `NEON_AUTH_BASE_URL` override. Neon must allow the canonical production domain and stable branch URL. Email sign-up/sign-in and verification codes are enabled. The current shared Neon sender is suitable for the sandbox; configure a dedicated email sender before a public production launch. Missing provider/database configuration fails explicitly.

Hosted company navigation lists only owned companies or accepted memberships. Shareholder and company views load separate authorized server projections. Existing Vercel Deployment Protection settings are preserved.

The original Sites Worker demo is retained at `dist/server/index.js`, with its existing project identity in `.openai/hosting.json`. It requires a `DB` D1 binding and a trusted gateway identity. It and the optional offline export retain the earlier single-user demo flow; the company/team access platform runs on Vercel and localhost. No Sites deployment is created by this change.

## Holding evidence and manual review

Signed-in shareholders now submit a PDF, PNG or JPEG holding statement from a campaign's Register action. Enter shares and the date evidenced by the statement. Each file is limited to 2 MB; up to 10 immutable versions are kept per registration. Pending submissions wait for review. A request for more information or rejection includes the reviewer's reason and lets the shareholder submit a new version before registration closes.

Company Owner/Admin/Operator members use Shareholders → Review to download the exact document version, request more information, reject, or approve the shares and holding date. Approval requires a reason and confirmation that the holder name, company, shares and campaign record date were checked. Another reviewer must review a team member's own submission. Viewers, unrelated accounts, platform administrators without a company reviewer membership, and other companies cannot access the files. All reads recheck account and company membership permissions.

Files and decisions are stored in separate private database tables through `/api/holding-evidence`, with no public file URL. Responses use `no-store`; downloads are attachments with `nosniff` and a restrictive content policy. Document bytes and filenames never enter workspace JSON, localStorage, public campaign responses or audit logs. Small bounded files currently use private Neon/SQLite storage alongside the existing internal company document service; a larger-volume rollout should move file contents to managed private object storage with an explicit retention policy. Company-registration documents remain staff-only and separate.

Each submission/review updates the company state, immutable evidence/decision and team audit atomically with revision and current-access checks. Stale reviews cannot approve an older version. Pending and needs-information submissions block snapshot locking; after locking, shares, document versions and eligibility are read-only. The registration switch blocks new registrations while permitting requested follow-up on existing registrations. Platform pauses block changes.

This is a real upload and manual eligibility-review workflow. It does not authenticate a statement with a broker or complete third-party KYC. Wallet ownership uses signed messages; payouts remain simulated. Use synthetic or redacted test documents while those integrations and operational policies are unfinished.

## Receiving wallets and ownership verification

Open **Shareholder → Identity & wallets → Connect wallet**, choose Ethereum, BNB Chain or Solana, approve connection in your wallet, review the address and press **Sign message**. This is available before completing KYC or registering holdings. The server verifies the signature and saves the address to your authenticated account, so saved wallets appear on other devices after email sign-in. Opening a campaign's receiving-wallet step lets you choose a saved verified wallet for that campaign's supported network.

Browser wallets are discovered through EIP-6963/EIP-1193 for Ethereum/BNB and Solana Wallet Standard, with injected Phantom/Solflare support. Ethereum/BNB verification currently supports standard signing accounts (EOAs), not contract-wallet signatures. Mobile users need a wallet app's in-app browser; QR/WalletConnect and general mobile-browser deep links are not implemented. A wallet app must support the selected network and message signing.

The wallet requests a connection and a plain message signature only: no transaction, token approval, permit, private key or seed phrase. The backend generates a five-minute, one-use challenge bound to the signed-in account, trusted provider session, site origin, address and network. Account/network changes cancel an in-progress signing flow. Cross-account/session replay, expired/used challenges, excessive attempts and stale wallet selections are rejected. A wallet may be independently verified for multiple accounts; this does not merge identities or enable wallet-based login.

`/api/wallets` and additive migration `0005_wallets.sql` store a separate per-account registry, immutable proof history and private wallet audit. Nonce consumption, wallet saving and audit commit atomically. Workspace/list responses expose only your own saved address/network/time/revision; signatures and session bindings are not exposed in those responses, public campaigns, company JSON or browser storage. Disabled accounts cannot manage wallets and outstanding challenges are invalidated on disable.

**Manage → Remove wallet** unlinks the saved address and invalidates outstanding matching challenges; it preserves campaign records and previous payouts. Reverification restores the same registry entry with a new proof. New campaign selections require a current proof owned by the signed-in account. Any claim locks that campaign's receiving address/network; removing a proof-bound wallet blocks subsequent simulated claims/distributions until the same address is verified again. Older demo addresses/history are retained and remain explicitly unverified, never automatically promoted to a signed proof. Legacy simulated payouts remain compatible; a future real payout service must require current verification for every recipient.

This release implements wallet control verification and receiving-address selection. The wallet-linking flow does not request transactions, approvals or gas. The separate private Sepolia pilot below adds test-token deployment and claims. Existing regular campaigns, test ledgers and `SIM-` distributions remain simulations.

## Private Sepolia pilot

This first on-chain flow is a **private, synthetic pilot** independent of KYC and holding documents. Existing campaigns and simulation balances are retained. It is not a mainnet payout rollout or an integration with an existing company token.

1. A company Owner/Admin opens **Company → Campaigns → New testnet pilot**. Enter a name, a whole test amount (1–1,000,000) and your own verified Ethereum receiving wallet. Confirm that this is a synthetic allocation. The pilot starts with one fixed participant, a locked allocation, 100% unlock and a 30-day UTC claim window. No real profile, KYC or holdings status is changed.
2. Choose **Prepare deployment**, select a verified deployment wallet and review the maximum test supply, network and sender. Connect your wallet and confirm the deployment yourself. The contract creates a new six-decimal ERC-20 test token with the company's symbol; it mints only when a valid allocation is claimed, so no token deposit or approval is needed. Sepolia test ETH is required for gas.
3. Use **Check status** to find the token contract. In **Shareholder → My rewards → View testnet reward**, select **Claim test tokens**, review the exact amount/address/contract and confirm the separate claim transaction in the receiving wallet.
4. Check status again. **Submitted** and **Included · awaiting finality** remain pending. The server verifies the exact action, canonical receipt, expected reward event and Ethereum's `finalized` block before marking the allocation claimed. Finality can take several minutes. Confirmed transaction hashes, contract addresses and blocks appear in the company Distributions page and CSV with Sepolia labels, separate from simulated totals.

The wallet runtime hardcodes chain ID **11155111**, sends zero native value and exposes transaction sending only in the explicit testnet flow. The Solidity constructor also rejects every other chain. The backend has no signing key and never broadcasts a transaction. It checks sender, network, zero value, exact creation/call data, target contract and globally unique transaction hash. Merkle proofs bind each index, receiving address and full allocation; contract state prevents a second mint for the same index. No name, email, identity evidence or real shareholding data is placed on-chain.

The deployment wallet can **Pause on Sepolia / Resume on Sepolia**. This authority stays with that wallet after a portal role change. Portal disabling, company suspension or campaign moderation blocks new portal preparation but does not change the deployed contract or stop direct on-chain calls. Unlinking a wallet blocks new portal claim preparation, not the contract's already committed allocation. This pilot does not provide production multisig ownership, identity revocation, staged unlocks or delegated controllers.

If a wallet transaction was sent but the page did not save its hash, use **Add transaction hash** from wallet activity instead of sending another transaction. Failed transactions keep their history; recovery verifies that the original hash matches the prepared action. Speed-up/cancellation replacements with a different hash are not supported in this first pilot; do not treat a pending record as a confirmed payout. An unused pilot can be archived before deployment preparation; a deployed pilot can be archived once allocations are fully settled. Archiving retains its token and transaction records and does not alter the contract. Pilots never enter public campaign discovery and platform controls cannot list them, even when their company is listed.

`/api/testnet`, `server/testnet.mjs` and additive migration `0006_testnet.sql` store private preparations and receipt tracking separately from existing simulation ledgers. Final settlement and deployment preparation lock the shared company revision, preventing concurrent claims, edits or archiving from overwriting each other. No simulation treasury debit funds a testnet mint. RPC reads use the public Sepolia endpoint by default; optional server-only **SEPOLIA_RPC_URL** can point to a managed HTTPS endpoint. No RPC credential is exposed in browser code or error responses. `vercel.json` explicitly packages the compiled contract artifact for the API.

`npm run build` compiles `contracts/CurrencTestAirdrop.sol` with pinned Solidity/OpenZeppelin versions. `npm test` uses an isolated in-process EVM with test accounts; it never connects to a user's wallet or broadcasts to public Sepolia. These checks and manual local-browser QA do not substitute for a user-confirmed Sepolia deployment and claim.

## Sandbox scope

Third-party KYC, broker checks and regular campaign distributions are simulated. Private Sepolia pilots support actual testnet token transactions. Login, wallet signatures, staff company setup, evidence storage, manual campaign reviews and access controls are real application features; platform approval is a manual publishing decision and does not independently verify legal company representation. Test tokens have no asset value. `SIM-` record IDs are not blockchain transaction hashes. Do not enter shareholder identity documents, broker credentials, wallet private keys or seed phrases.

CURRENC Group / CURR is a real-brand demo; Northstar Labs / NRTH and Harbor Energy / HBR are fictional. All campaign and shareholder data is sample data.

One allocation is shared across receiving networks. Each network has its own test balance; there is no cross-chain bridge. Wallet changes are blocked after a claim. Allocations round down to 6 decimals; caps and rounding remainders are not redistributed. Unlock percentages are raised manually. Form dates use UTC; activity times use Hong Kong time.

Not implemented: third-party KYC, broker or company representation verification, independent historical holdings verification, contract-wallet signatures, WalletConnect, production contracts or mainnet transfers, Solana/BNB on-chain payouts, enterprise SSO, dual approval, automatic invitation emails, automated snapshots or linear vesting.
