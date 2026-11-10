# Currenc Connect

A local shareholder rewards workspace for companies and investors. English is the current interface language; Chinese selection will be added later.

## Run locally

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. `http://127.0.0.1:5173` also works. On Mac, double-click `Start.command` or run `zsh Start.command`.

Node.js **22.13 or later** is required. If the default Node is older, the launcher can use a compatible version already installed through nvm. Run `npm ci` after cloning to install the pinned Neon database and Auth SDKs used by the Vercel APIs. The localhost server continues to use built-in Node modules.

The local HTTP server stores workspace data in `.local/workspace.sqlite`. Data survives browser reloads and server restarts. Company and shareholder views share one demo workspace. The server listens on loopback only.

To use another port:

```sh
PORT=5174 npm run dev
```

Stop with Ctrl+C. Source changes require restarting the server to rebuild the app. Existing local data is preserved. The previous offline HTML uses separate browser storage; it is not automatically imported into the local database.

## Demo flow

1. Select **Shareholder**, then **CURRENC Group → View rewards → Register**.
2. Complete demo KYC with `Demo Investor / demo@example.com` and register 5,000 shares.
3. Select Ethereum, Solana or BNB Chain and save the supplied demo wallet address.
4. Select **Company → Shareholders** and approve Iris. Approve your own registration too if you chose manual statement review.
5. Open **Campaigns → Shareholder Welcome Rewards → Preview snapshot → Lock snapshot**.
6. Select **Shareholder → My rewards → View reward → Simulate claim** to claim 500 uCURR.
7. Return to **Company** to check Treasury, Distributions and CSV exports.

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
| `vercel.json` | Vercel output and response headers |
| `drizzle/0000_workspace.sql` | Initial database schema |
| `tests/` | Domain, API, UI and localhost regression tests |

Known sample Chinese labels from earlier local data are displayed in English without resetting the database. User-authored campaign names and other content are retained.

## GitHub and future hosting

Repository: [bennyc-seamlessgroup/currenc-connect](https://github.com/bennyc-seamlessgroup/currenc-connect).

Vercel deployment is configured in `vercel.json`: the build command is `npm run build`, the framework preset is Other, and the output directory is `dist/client`. Node is pinned to 22.x. The build retains the separate Worker output for localhost and Sites.

The native `/api/workspace` function uses Neon Postgres through `@neondatabase/serverless`. Connect a Neon database to this Vercel project, enable the connection for Production and Preview, and redeploy. The integration must supply `DATABASE_URL` or `POSTGRES_URL`; never commit either value. The adapter creates its dedicated `currenc_connect_workspaces` table on first use and preserves the revision lock used for claims.

The hosted app uses managed Neon Auth (Better Auth) with email verification codes. Open the app, enter your email and enter the 6-digit code from Neon. Signing in with the same account loads the same workspace across browsers, devices and the configured app URLs. Sign out from the sidebar. Login verifies email ownership; it does not verify KYC or shareholdings.

The API validates the provider session on every request and keys records by the provider user ID, never by a caller-supplied email or header. Auth tokens stay in secure HttpOnly cookies and are not returned to frontend JSON or stored in localStorage. Cached session cookies are excluded so provider revocation is checked immediately. The SDK-required cache signer is ephemeral because that cache is disabled; it does not sign or validate the actual provider session.

On first account login, an existing browser demo is atomically moved into the account if the account has no saved workspace. Its data and revision are preserved. An existing account workspace is never overwritten or merged with a different browser demo; that unimported demo remains in the database. Local SQLite and offline browser data are not uploaded automatically. Clearing login cookies signs the browser out; it no longer discards the account workspace.

Auth configuration lives in `server/auth-config.mjs` (a public service URL, not a credential), with optional `NEON_AUTH_BASE_URL` override. Neon must allow the canonical production domain and stable branch URL. Email sign-up/sign-in and verification codes are enabled. The current shared Neon sender is suitable for the sandbox; configure a dedicated email sender before a public production launch. Missing provider/database configuration fails explicitly.

Company memberships, invitations and enterprise role permissions remain future work. The company/shareholder toggle still selects demo views within one authenticated account. Vercel Deployment Protection settings are preserved.

The original Sites Worker target is retained at `dist/server/index.js`, with its existing project identity in `.openai/hosting.json`. It requires a `DB` D1 binding and a trusted gateway supplying the authenticated user identity. This is separate from the planned Vercel deployment.

## Sandbox scope

All KYC, holdings, wallet verification and distributions are simulated. Test tokens have no asset value. `SIM-` record IDs are not blockchain transaction hashes. Do not enter real identity documents, broker credentials, wallet private keys or seed phrases.

CURRENC Group / CURR is a real-brand demo; Northstar Labs / NRTH and Harbor Energy / HBR are fictional. All campaign and shareholder data is sample data.

One allocation is shared across receiving networks. Each network has its own test balance; there is no cross-chain bridge. Wallet changes are blocked after a claim. Allocations round down to 6 decimals; caps and rounding remainders are not redistributed. Unlock percentages are raised manually. Form dates use UTC; activity times use Hong Kong time.

Not implemented: real KYC or broker integration, historical holdings evidence, wallet signatures, smart contracts, gas, on-chain transfers or reconciliation, production company permissions, invitations, dual approval, automated snapshots or linear vesting.
