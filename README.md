# Currenc Connect

A shareholder rewards platform with company workspaces, teams and individual investor accounts. English is the current interface language; Chinese selection will be added later.

Signed-out visitors first see a public service introduction explaining company token airdrops based on eligible shareholdings, an editorial hero image and a horizontal **Current campaigns** row. Only active, listed companies with published, visible and unexpired campaigns appear. **View campaign** shows public terms; **Sign in to continue** remembers the selected campaign through verified login and first shareholder onboarding. **Back to introduction** returns without losing invitation context. Signed-in accounts continue to their workspace.

The hero uses the user-approved transparent illustration of a shareholder **keeping their stock holdings and receiving additional token rewards**. The PNG is displayed in full on the page background; it has no embedded text or shares-to-token conversion arrow. Current campaigns has no search field: cards stay in one horizontal row, with native swipe/trackpad/keyboard scrolling and previous/next controls only when the row overflows. The controls disable at either end. A single card fits the phone viewport; multiple phone cards reveal part of the next card.

The read-only `/api/public-campaigns` endpoint requires no account and creates no identity. Its explicit projection excludes shareholder records, wallets, transactions, treasury, contacts, files, membership and internal moderation notes. Changes to listing and registration controls are reflected without a public cache. A `?campaign=...` link is navigation context, never authorization. The page no longer displays global Sandbox/Preview labels; verification and distribution capabilities remain simulated and their action-level descriptions remain accurate. The approved vertical hero asset and generation prompt are recorded in `src/assets/landing/README.md`.

## Run locally

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. `http://127.0.0.1:5173` also works. On Mac, double-click `Start.command` or run `zsh Start.command`.

Node.js **22.13 or later** is required. If the default Node is older, the launcher can use a compatible version already installed through nvm. Run `npm ci` after cloning to install the pinned Neon database and Auth SDKs used by the Vercel APIs. The localhost server continues to use built-in Node modules.

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

## Platform console and company management

Platform administrators are separate from company owners/admins. The **Platform console** contains Companies, Accounts, Portal settings and Audit log. There is no company submission or review queue.

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

**Remove portal access** blocks all protected workspace/document access and moves the record to **Removed**. **Restore access** re-enables that account and its existing memberships. Account records, provider identity, rewards, company ownership and audit history are retained. Removing access also revokes pending company invitation links for that email. Platform administrators must first lose their platform role; the platform owner and the acting administrator's own account remain protected. This is reversible portal-access removal, not deletion of a Neon identity.

The ⓘ controls explain account access, company roles/listing, campaign moderation, the announcement and campaign-registration setting. Hover/focus shows a tooltip on desktop; clicking opens the same readable explanation on keyboard/touch devices. **Portal announcement** is a plain-text notice at the top of signed-in workspace pages; clear the field to remove it. **Accept new shareholder campaign registrations** controls new holdings registrations in published campaigns, not new account creation or existing reward claims.

The shareholder Companies page now gives a short introduction and three steps: choose a company, add profile/holding details, then add a wallet and claim available rewards. Chain symbols use unchanged official Ethereum/Solana/BNB Chain SVG marks, embedded locally with no third-party image requests. Sources are recorded in `src/assets/chains/README.md`. Verification and payouts remain simulated.

### Initialize the platform owner

Set **`PLATFORM_BOOTSTRAP_OWNER_EMAIL`** in the Vercel project's **Production** environment to the intended operator's verified login email, then redeploy. Keep this deployment-controlled value server-side; do not commit a real operator email or add a client-exposed prefix. The trusted issuer is the configured Neon Auth service. The first matching verified account is bound as the sole platform owner **by its authenticated account ID**. There is no first-user, company-owner, request-header or self-service route to platform privileges. Later changes to the bootstrap email do not transfer ownership. Other platform admins are delegated by the initialized owner through Accounts.

Localhost explicitly bootstraps its loopback-only developer identity for review. This is development configuration, never a production fallback.

Existing sample companies remain intact and hidden/inactive until staff choose **Activate company**, then **List on portal**. This enables sandbox operations and does not assert real company, KYC or legal verification.

## Existing demo flow

1. Select **Shareholder**, then **CURRENC Group → View rewards → Register**.
2. Complete demo KYC with `Demo Investor / demo@example.com` and register 5,000 shares.
3. Select Ethereum, Solana or BNB Chain and save the supplied demo wallet address.
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

This is a real upload and manual eligibility-review workflow. It does not authenticate a statement with a broker or complete third-party KYC. Wallet ownership and payouts remain simulated. Use synthetic or redacted test documents while those integrations and operational policies are unfinished.

## Sandbox scope

KYC, holdings, wallet verification and distributions are simulated. Login, staff company setup, evidence storage, manual campaign reviews and access controls are real application features; platform approval is a manual publishing decision and does not independently verify legal company representation. Test tokens have no asset value. `SIM-` record IDs are not blockchain transaction hashes. Do not enter shareholder identity documents, broker credentials, wallet private keys or seed phrases.

CURRENC Group / CURR is a real-brand demo; Northstar Labs / NRTH and Harbor Energy / HBR are fictional. All campaign and shareholder data is sample data.

One allocation is shared across receiving networks. Each network has its own test balance; there is no cross-chain bridge. Wallet changes are blocked after a claim. Allocations round down to 6 decimals; caps and rounding remainders are not redistributed. Unlock percentages are raised manually. Form dates use UTC; activity times use Hong Kong time.

Not implemented: third-party KYC, broker or company representation verification, independent historical holdings verification, wallet signatures, smart contracts, gas, on-chain transfers or reconciliation, enterprise SSO, dual approval, automatic invitation emails, automated snapshots or linear vesting.
