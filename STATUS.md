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
- Vercel is planned for later. No Vercel deployment or public authentication has been configured. A hosted database and API adapter are still required.
- Original Sites project identity is retained. Sites Git read access was verified in the preceding access check; the Site remains unpublished.
- Sandbox only: real identity checks, broker APIs, wallet signatures and on-chain transactions remain unimplemented.

## Verification

- 16 automated tests pass, including the complete demo flow, cross-chain allocation, concurrent claim protection, legacy English display and mobile menu behavior.
- Local regression tests use a separate temporary database and confirm writes on both loopback hostnames, persistence across restarts, and rejection of cross-origin requests and invalid hosts.
- Build and asset validation pass. Company and shareholder pages, English forms, and phone navigation were checked in the browser at desktop and 390px phone widths. No page-level horizontal overflow was observed; wide tables scroll within their containers.
