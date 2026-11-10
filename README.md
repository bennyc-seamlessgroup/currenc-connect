# Currenc Connect

A local shareholder rewards workspace for companies and investors. English is the current interface language; Chinese selection will be added later.

## Run locally

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. `http://127.0.0.1:5173` also works. On Mac, double-click `Start.command` or run `zsh Start.command`.

Node.js **22.13 or later** is required. If the default Node is older, the launcher can use a compatible version already installed through nvm. Run `npm ci` after cloning to install the pinned Neon driver used by the Vercel API. The localhost server continues to use built-in Node modules.

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
| `api/workspace.js` | Native Vercel API entry |
| `server/` | Cloud database and sandbox session adapters |
| `vercel.json` | Vercel output and response headers |
| `drizzle/0000_workspace.sql` | Initial database schema |
| `tests/` | Domain, API, UI and localhost regression tests |

Known sample Chinese labels from earlier local data are displayed in English without resetting the database. User-authored campaign names and other content are retained.

## GitHub and future hosting

Repository: [bennyc-seamlessgroup/currenc-connect](https://github.com/bennyc-seamlessgroup/currenc-connect).

Vercel deployment is configured in `vercel.json`: the build command is `npm run build`, the framework preset is Other, and the output directory is `dist/client`. Node is pinned to 22.x. The build retains the separate Worker output for localhost and Sites.

The native `/api/workspace` function uses Neon Postgres through `@neondatabase/serverless`. Connect a Neon database to this Vercel project, enable the connection for Production and Preview, and redeploy. The integration must supply `DATABASE_URL` or `POSTGRES_URL`; never commit either value. The adapter creates its dedicated `currenc_connect_workspaces` table on first use and preserves the revision lock used for claims.

The hosted sandbox identifies each browser using a random, secure, HttpOnly session cookie. Both demo roles share that browser workspace; different sessions are isolated. This is **not account login or production enterprise authorization**. The cookie lasts 30 days; clearing it starts a new workspace. Local data is not automatically uploaded. Missing database configuration produces a clear 503 response rather than storing data in temporary server memory or silently switching to browser storage.

Production account authentication, company permissions and recovery across devices remain future work. Vercel Deployment Protection settings are preserved.

The original Sites Worker target is retained at `dist/server/index.js`, with its existing project identity in `.openai/hosting.json`. It requires a `DB` D1 binding and a trusted gateway supplying the authenticated user identity. This is separate from the planned Vercel deployment.

## Sandbox scope

All KYC, holdings, wallet verification and distributions are simulated. Test tokens have no asset value. `SIM-` record IDs are not blockchain transaction hashes. Do not enter real identity documents, broker credentials, wallet private keys or seed phrases.

CURRENC Group / CURR is a real-brand demo; Northstar Labs / NRTH and Harbor Energy / HBR are fictional. All campaign and shareholder data is sample data.

One allocation is shared across receiving networks. Each network has its own test balance; there is no cross-chain bridge. Wallet changes are blocked after a claim. Allocations round down to 6 decimals; caps and rounding remainders are not redistributed. Unlock percentages are raised manually. Form dates use UTC; activity times use Hong Kong time.

Not implemented: real KYC or broker integration, historical holdings evidence, wallet signatures, smart contracts, gas, on-chain transfers or reconciliation, production company permissions, invitations, dual approval, automated snapshots or linear vesting.
