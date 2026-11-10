# Currenc Connect

A shareholder rewards platform with company workspaces, teams and individual investor accounts. English is the current interface language; Chinese selection will be added later.

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

New hosted accounts choose **Continue as a shareholder** or **Register a company**. Creating a company grants ownership of that new private workspace only. Company names and tickers do not grant access to an existing company. A new company starts with no campaigns, shareholders or test funds, and must pass platform review before publishing or accepting registrations. Owners and operators can prepare campaign drafts while the company application is incomplete.

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

## Platform console and company registration

Platform administrators are separate from company owners/admins. The **Platform console** provides the review queue, company listings, account access, portal settings and an audit log. Platform review access includes private company application evidence, not automatic membership or access to company shareholder ledgers.

Company owners/admins complete **Company application** with legal name, registration number, jurisdiction, HTTPS website, contact details, representative role and authorization confirmation. Upload both **Company registration** and **Representative authority** evidence, then submit for review. Drafts can be saved. Submitted/approved evidence is locked; requesting information or rejecting an application allows correction and resubmission. Each submission snapshots the application and evidence metadata. Reviews use revisions to prevent approving stale or concurrently changed information.

Evidence accepts PDF, PNG and JPEG up to **2 MB per file**. It is stored privately in the existing database, separately from business JSON, with a content hash and immutable versions. Up to 20 versions per company are retained. Replacing a file archives its earlier version, which remains available to authorized reviewers through submission history. Downloads use authenticated `/api/company-document` requests, attachment headers and `no-store`; there are no public file URLs. Owners/admins of the relevant company and platform administrators can read evidence. Company operators/viewers and unrelated accounts cannot.

Review actions include approve, request information, reject, suspend/restore and list/hide. Only approved, listed companies with published, visible campaigns appear in the directory. Hiding removes new public registrations but retains existing shareholders' records. Company suspension and platform campaign pauses prevent simulated payouts and operational writes without removing allocations or transactions. Restoring a company that was never approved returns it to application review, not public access. Portal settings can pause new company submissions, pause new shareholder campaign registrations, and display a plain-text notice.

Accounts can be suspended/restored at the application level. Suspension blocks protected API and evidence access on the next request; it does not delete data or delete the Neon identity. Platform administrators are protected from account suspension until their platform role is removed. Only the platform owner can appoint/remove platform admins, and the platform owner cannot be demoted or suspended through the app. Platform admins can appoint registered company administrators or adjust non-owner company member roles, with audit records. Company ownership remains unchanged.

### Initialize the platform owner

Set **`PLATFORM_BOOTSTRAP_OWNER_EMAIL`** in the Vercel project's **Production** environment to the intended operator's verified login email, then redeploy. Keep this deployment-controlled value server-side; do not commit a real operator email or add a client-exposed prefix. The trusted issuer is the configured Neon Auth service. The first matching verified account is bound as the sole platform owner **by its authenticated account ID**. There is no first-user, company-owner, request-header or self-service route to platform privileges. Later changes to the bootstrap email do not transfer ownership. Other platform admins are delegated by the initialized owner through Accounts.

Localhost explicitly bootstraps its loopback-only developer identity for review. This is development configuration, never a production fallback.

Existing sample workspaces remain intact but begin hidden with a draft application. A platform reviewer may explicitly use **Approve sample workspace** for deterministically identified legacy samples, with a reason. This allows sandbox publishing without claiming legal company or representative verification. New companies must follow the normal evidence/submission flow; they cannot request the sample exemption.

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

## Sandbox scope

KYC, holdings, wallet verification and distributions are simulated. Login, company applications, evidence storage and access controls are real application features; platform approval is a manual publishing decision and does not independently verify legal company representation. Test tokens have no asset value. `SIM-` record IDs are not blockchain transaction hashes. Do not enter shareholder identity documents, broker credentials, wallet private keys or seed phrases.

CURRENC Group / CURR is a real-brand demo; Northstar Labs / NRTH and Harbor Energy / HBR are fictional. All campaign and shareholder data is sample data.

One allocation is shared across receiving networks. Each network has its own test balance; there is no cross-chain bridge. Wallet changes are blocked after a claim. Allocations round down to 6 decimals; caps and rounding remainders are not redistributed. Unlock percentages are raised manually. Form dates use UTC; activity times use Hong Kong time.

Not implemented: third-party KYC, broker or company representation verification, historical holdings evidence, wallet signatures, smart contracts, gas, on-chain transfers or reconciliation, enterprise SSO, dual approval, automatic invitation emails, automated snapshots or linear vesting.
