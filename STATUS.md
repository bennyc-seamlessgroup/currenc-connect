# Current status

Updated: 10 November 2026 (Hong Kong).

- Primary app: **http://localhost:5173**, launched with `npm run dev` or `Start.command`. The current task leaves the local server running for review.
- English interface throughout company and shareholder pages, forms, errors and exports. Chinese language selection is deferred.
- Simplified layout: removed promotional hero sections, slogans, repeated explanatory text and decorative onboarding panels. Larger readable type, compact navigation, campaigns, review queue and treasury summaries.
- Data: existing `.local/workspace.sqlite` is retained. Known legacy sample labels are presented in English without resetting stored data. Offline browser data remains separate.
- Local writes work from both `localhost` and `127.0.0.1`. The local adapter retains same-origin checks and rejects unapproved Host headers.
- The launcher automatically selects a compatible nvm Node runtime when the default Node is too old.
- Default builds no longer generate the offline HTML. `npm run build:offline` remains available as an optional export.
- GitHub origin is configured: https://github.com/bennyc-seamlessgroup/currenc-connect.git. This repository is the target for the versioned source baseline. Local SQLite data, generated output and environment files are excluded from Git.
- Vercel deployment support is implemented: `dist/client` browser assets, native `/api/workspace`, Node 22.x, and a Neon cloud database adapter. The original failed deployment reported `STATIC_BUILD_NO_OUT_DIR` because Vercel expected `public`. A Neon database connection is required for the hosted API. Hosted account access uses managed Neon Auth with email codes and verified email ownership. Workspaces are keyed by the verified provider user ID, so independent devices share the same account data. Localhost keeps its explicit development identity.
- Original Sites project identity is retained. Sites Git read access was verified in the preceding access check; the Site remains unpublished.
- Sandbox only: real identity checks, broker APIs, wallet signatures and on-chain transactions remain unimplemented.

## Verification

- 31 automated tests pass, including the complete demo flow, cross-chain allocation, concurrent claim protection, legacy English display and mobile menu behavior.
- Local regression tests use a separate temporary database and confirm writes on both loopback hostnames, persistence across restarts, and rejection of cross-origin requests and invalid hosts.
- Build and asset validation pass. Company and shareholder pages, English forms, and phone navigation were checked in the browser at desktop and 390px phone widths. No page-level horizontal overflow was observed; wide tables scroll within their containers.

- Vercel-specific checks cover browser-only output, the API export, secure session isolation, ignored caller-supplied identities, persistent adapter state, concurrent claims, origin checks, and explicit missing-database errors. Live verification passed at https://currenc-connect.vercel.app: HTTP 200, cloud persistence, isolated sessions, the full 500-token demo claim flow, concurrent claims settling exactly once, and cross-origin rejection.

- Live account-login deployment is Ready (latest code deployment `CsiqomRRJPpbMAHKu1QrNeb11Erx`, source `dba2281`). Neon database `neon-fulvous-cable` is connected to Currenc Connect on the Free plan for Production and Preview. Existing deployment protection is preserved.

## Account login update

- Added email code login, sign-out, and strict authenticated workspace access. No passwords or auth tokens are stored by frontend code.
- Provider sessions are revalidated on protected requests; expired/revoked sessions return to sign-in and clear private dialogs.
- First login can atomically adopt the browser demo; existing account data is never overwritten.
- Added regression tests for two devices sharing one account, different-account isolation, legacy adoption, session expiry/revocation, forged identities, and the complete login UI flow.
- Managed provider: Neon Auth on the existing database branch. Application name: Currenc Connect. Trusted canonical and stable branch domains are configured; sign-up verification uses codes.
- Live email delivery and two independent account logins were completed by Benny and observed in Chrome and the Codex in-app browser. Both displayed the same account email.
- Cross-browser cloud persistence was verified through the UI: adding 1 simulated uCURR to the CURRENC Ethereum test ledger in Chrome updated its balance to 25,001; reloading the independent browser displayed the same balance. This leaves one test-funding audit entry and does not move real assets.
- Sign-out was verified in the independent browser: it returned to an enabled email login form and hid the workspace. Chrome retained its own valid session after reload and still displayed the saved 25,001 test balance.
- Live API checks return 401 without a verified account, 403 for cross-origin sign-out, and 400 for an invalid code. A forged caller identity and the previous anonymous cookie cannot unlock a workspace.
- Login layout was checked at 390 × 844 with no horizontal overflow. Regression coverage also confirms that sign-out clears private dialogs and leaves the login button ready for a new sign-in. Live session responses explicitly return `Cache-Control: no-store`.
