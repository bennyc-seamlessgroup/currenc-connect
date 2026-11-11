# Current status

Updated: 10 November 2026 (Hong Kong).

- Primary app: **http://localhost:5173**, launched with `npm run dev` or `Start.command`. The current task leaves the local server running for review.
- English interface throughout company and shareholder pages, forms, errors and exports. Chinese language selection is deferred.
- Simplified workspace layout: removed repeated explanatory text and decorative onboarding panels. Larger readable type, compact navigation, campaigns, review queue and treasury summaries. The public introduction has its own service overview, hero image and campaign discovery.
- Data: existing `.local/workspace.sqlite` is retained. Known legacy sample labels are presented in English without resetting stored data. Offline browser data remains separate.
- Local writes work from both `localhost` and `127.0.0.1`. The local adapter retains same-origin checks and rejects unapproved Host headers.
- The launcher automatically selects a compatible nvm Node runtime when the default Node is too old.
- Default builds no longer generate the offline HTML. `npm run build:offline` remains available as an optional export.
- GitHub origin is configured: https://github.com/bennyc-seamlessgroup/currenc-connect.git. This repository is the target for the versioned source baseline. Local SQLite data, generated output and environment files are excluded from Git.
- Vercel deployment support is implemented: `dist/client` browser assets, native `/api/workspace`, Node 22.x, and a Neon cloud database adapter. Hosted account access uses managed Neon Auth with email codes and verified email ownership. Personal records are keyed by the verified provider user ID; company access requires a database membership. Independent devices share the same personal records and permitted company data. Localhost keeps its explicit development identity.
- Original Sites project identity is retained. Sites Git read access was verified in the preceding access check; the Site remains unpublished.
- Sandbox only: real identity checks, broker APIs, wallet signatures and on-chain transactions remain unimplemented.

## Verification

- 77 automated tests pass, covering the complete demo flow, cross-chain allocation, concurrent claims, account login, public campaign privacy/browsing/login continuity, company/platform role separation, private evidence, stale/concurrent reviews, portal controls, suspension and role-aware UI behavior.
- Local regression tests use a separate temporary database and confirm writes on both loopback hostnames, persistence across restarts, and rejection of cross-origin requests and invalid hosts.
- Build and asset validation pass. Company and shareholder pages, English forms, and phone navigation were checked in the browser at desktop and 390px phone widths. No page-level horizontal overflow was observed; wide tables scroll within their containers.

- Vercel-specific checks cover browser-only output, the API export, secure session isolation, ignored caller-supplied identities, persistent adapter state, concurrent claims, origin checks, and explicit missing-database errors. Live verification passed at https://currenc-connect.vercel.app: HTTP 200, cloud persistence, isolated sessions, the full 500-token demo claim flow, concurrent claims settling exactly once, and cross-origin rejection.

- The account-login baseline (`dba2281`) and company permissions rollout (`c3083bf`, deployment `5dGU2bGXPdThe5B29dMqAqVnqcWi`) are Ready. Neon database `neon-fulvous-cable` is connected to Currenc Connect on the Free plan for Production and Preview. Existing deployment protection is preserved.

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

## Public introduction and sign-in entry

- Signed-out visitors see an English service introduction before any email form: company token airdrops based on eligible real shareholdings, the role of campaign rules, three participation steps and a clear sandbox status. Get started / Sign in opens the existing email-code login; authenticated users keep their normal workspace flow.
- Added `src/landing-ui.js`, responsive layouts and public-page metadata. The sign-in form retains invitation-email context, resend/back/error handling and keyboard focus. Sign-out returns to the introduction; expired workspace sessions clear private state and return to sign-in. Initial session loading no longer shows placeholder company navigation or a demo identity.
- All 72 tests, build/asset checks and whitespace checks pass. Native-browser local QA passed for introduction → email → invalid code/retry → successful login → sign-out, plus invitation navigation coverage in the UI regression suite. Local browser OTP delivery is simulated in an isolated in-memory preview; no test emails are sent or production identities created. Desktop and 390 × 844 introduction/sign-in views have no page-level horizontal overflow.
- Production source `3295df7` is Ready (deployment `Cyw6Yffc23hEkk7pG76UrinLdcYK`). The canonical site was verified signed out: service introduction, Get started → email form, return to introduction, desktop and 390px layout, and no browser errors. Existing managed sign-in endpoints and permissions are unchanged; no live OTP was requested in this presentation update. The isolated preview server was stopped; the primary localhost server remains running with the user's original database.

## Public campaigns and hero imagery

- Latest design decision: remove global Sandbox/Preview labels from the introduction, sign-in, workspace header/footer and runtime environment labels. Operational KYC, wallet and payout descriptions remain accurate; no real verification or blockchain integration has been added.
- Replaced the right-side diagram with a generated editorial still-life image of certificates and tokens, optimized as a local JPEG and served by Vercel and the local/Worker asset build. The original prompt is recorded with the asset; no external image service is used at page load.
- Added searchable Current campaigns with public detail dialogs. The anonymous read-only endpoint includes only active/listed companies and published/visible campaigns whose claim deadline has not passed. Public terms are allowlisted; private shareholders, wallets, funds, legal/contact details, files, team data and internal notes never enter the response. No identity is created. Responses are no-store and mutations return 405.
- Selection persists through `?campaign=` and verified sign-in into the shareholder view, including first-time onboarding. Hidden or removed campaigns are rechecked against the authenticated response; URL parameters cannot grant access. The introduction and discovery load independently of the initial session check.
- All 77 tests, build and asset checks pass. Isolated native-browser QA verified search, public terms, selected-campaign sign-in, first onboarding, returning to the same campaign and sign-out, using simulated local OTP delivery with no outgoing email. Desktop and 390px views have no horizontal overflow; the hero image loaded at its expected resolution and the flow produced no browser errors.
- Production source `5ae86aa` is Ready (deployment `9MArNPyY1fYoXHct2C8gxqtmf5vq`). Anonymous API verification returned HTTP 200, no-store and only the allowlisted campaign/company fields. Native live verification passed for the existing listed campaign, search, public detail, selection retained into sign-in, hero loading and 390px layout; no Sandbox/Preview display text or browser errors remain on the public page. No live OTP was sent, account/role was changed, or existing company/campaign/funds were modified. The isolated QA server is stopped; the primary localhost server retains the original database.

## Approved vertical hero and campaign row

- Replaced the still life with the exact user-approved stock-holdings card → token-airdrop artwork, optimized as `shareholder-rewards-vertical.jpg` (1024 × 1536). The full image is contained rather than cropped at both desktop and phone sizes, and its new filename avoids stale copies of the old image.
- Removed campaign search markup, state, filtering and handlers. Public cards now occupy one horizontal scroll-snap row. Native scrolling, focusable keyboard access and previous/next controls support overflow; controls hide when all cards fit and disable at either end. Phone rows with multiple cards reveal the next card, while a single card fits the viewport.
- All 77 existing tests pass, including the adapted public browsing, escaping and sign-in-continuation regression. Build/asset and whitespace checks pass. Native isolated QA with five synthetic campaigns verified desktop next scrolling, phone horizontal scroll to the end, disabled end control and opening the final campaign. Desktop and 390px phone measurements have no page-level horizontal overflow. Test campaigns remain in memory only and do not enter the live database.
- Production source `b905f4b` is Ready (deployment `85RznHc1TnrnPoASnBLNBbuPfAKa`). Live verification confirmed the approved 1024 × 1536 image, no search field, the existing single campaign, controls hidden when the row fits, and the full 310 × 465 phone image without page-level overflow. Browser error logs are empty. No live account, campaign, membership or balance was modified; the isolated QA server is stopped and the primary localhost server remains running.

## Transparent shareholder illustration

- Latest approved hero: a text-free flat illustration of a shareholder with an intact portfolio plus separately arriving parachute tokens. The phone-holding hand is the corrected version approved by the user. This replaces the shares-to-token arrow image so the artwork conveys additional rewards rather than converting shares.
- Copied the exact approved 1122 × 1402 PNG into `src/assets/landing/shareholder-rewards.png`. The build serves image/png and preserves the original bytes and alpha; the outer hero container is transparent. No new image generation, crop or redesign was performed during integration.
- All 77 tests, build/asset checks and whitespace checks pass. Native local desktop and 390px phone checks confirm the image loads, stays fully contained (310 × 387 on phone) and blends into the page with no page-level horizontal overflow. Public campaign behavior, account access and data remain unchanged.

## Company workspaces and permissions

- Added company creation and first-account onboarding. A new company starts empty; new shareholders do not inherit sample investor records.
- Server-authorized Owner, Admin, Operator and Viewer memberships. Company data is shared with company members, and filtered to each company. Shareholder responses contain only public campaigns and the authenticated shareholder's registrations, wallets and payouts.
- Email-bound, seven-day invitation links with acceptance, revocation, member role changes, removal and transactional team audit. Invitations are shared using Copy link; no invitation email is sent automatically.
- Owners alone appoint/manage admins; admins can manage operators/viewers. Owners cannot be removed/demoted and members cannot modify their own role. Removed members lose company access on their next request, and the UI clears company state/dialogs.
- Legacy account workspaces migrate atomically into separate owned companies. The original JSON remains as an archive; balances, revisions, allocations and transactions are preserved. Old events without company IDs are kept in the original owner's personal activity so newly invited members cannot see other companies' history.
- Localhost runs the same platform service with one explicit local developer identity. Existing `.local/workspace.sqlite` is retained.
- Local desktop and 390 × 844 browser checks passed for company navigation, Team and invitation forms, with no horizontal overflow.
- Live verification passed at https://currenc-connect.vercel.app. Benny's three legacy companies, existing shareholders/campaigns and CURRENC's 25,001 uCURR Ethereum test balance were retained. The original account is Owner of its migrated companies.
- Benny created a Viewer invitation to a second controlled email, signed in independently and accepted it. The second account displayed the same CURRENC balance and campaign data with no campaign creation, review, team management or funding controls. Its personal My rewards list was empty and did not contain sample investors' records.
- Saving the existing Viewer role through the owner UI succeeded, preserving Viewer access and writing the team audit event in the same Postgres operation. Invite creation and acceptance also appeared in the team audit. The test Viewer membership is retained; no additional test funding was added in this update.
- Live APIs still reject signed-out and forged identities with 401, cross-origin writes with 403, and use `Cache-Control: no-store`.
- Company names are escaped throughout navigation, the public directory, reward dialogs and holdings registration. The UI regression test follows a company name containing HTML through publication and shareholder registration to prevent markup injection.
- Business state remains revision-protected JSON per company. Company representation verification, enterprise SSO, dual approval, automatic invitation email, KYC/broker providers and on-chain transfers remain future work.

## Staff-managed company registration

- Latest product decision: only the platform team registers companies and enters company information. Self-service company registration, application forms, submission/review queues, evidence requirements and the company-application portal setting have been removed. Retired self-service commands return 403 even for company owners/admins.
- Platform console → Companies → Add company creates an empty active, hidden workspace owned by its staff creator. Platform staff can save/edit company name, ticker, registration/legal/contact details, appoint company admins, activate/deactivate, suspend/restore and list/hide. Editing preserves ledgers and checks both business/state revisions. Token symbols remain fixed after creation.
- Inactive legacy companies are retained; activating a company requires no submission or evidence. Restoration keeps companies hidden. Existing balances, membership, historical submissions/files, allocations and transactions are preserved. Historical internal files are now restricted to platform staff.
- Platform account controls, shareholder-registration settings, announcements, campaign moderation and audit remain available. The existing verified Platform Owner and production environment configuration are unchanged.
- 57 automated tests pass, including disabled self-service routes, staff-only creation/editing, privacy, stale/concurrent edits and decisions, preservation of ledgers, company memberships, suspension and the complete simulated rewards flow. Build, asset validation and whitespace checks pass.
- Production source `03ed9bc` is Ready (deployment `DTZuRJaUZACfrzRAgwwEfCRoQEWa`). Live Postgres/browser verification passed for staff-only direct company creation, saving company information, persistence after reload, deactivation and conditional audit. The new synthetic QA company is inactive/hidden and has no campaigns or funds. The existing ordinary member's Settings page has no registration controls.
- Isolated localhost verification passed for direct creation, renaming and saved contact/registration details. Desktop and 390 × 844 company editing were checked without page-level horizontal overflow. Its temporary QA server was stopped; the primary localhost server retains the user's original database.

## Campaign lifecycle and access maintenance

- Added platform company-member removal, stale-role checks, protection of owners/self, automatic revocation of old pending company invitations on access changes, and direct pending-invitation revocation. Personal accounts and other company memberships remain intact; platform/team audit is atomic.
- Added draft editing, reversible draft deletion/restoration, published text/deadline editing, description-only changes after snapshot, and read-only archiving after allocated rewards settle. Separate registration/claim dates preserve legacy deadlines through fallback. Published rules cannot change and deadlines cannot be shortened.
- Owner/admin lifecycle permissions, operator editing and viewer read-only permissions are enforced server-side. Archived/deleted campaigns are excluded from public discovery, preserved for records and cannot be re-exposed by moderation controls.
- 71 automated tests pass, including legacy database upgrade, account invitation/verified acceptance, removal and restoration, clearing removed sessions, contextual help and network-image rendering. Build/asset checks pass.
- Added seven-day account sign-in invitations with manual link sharing, pending revocation and reversible removal/restoration of portal access. Actual identities are created only by verified sign-in; invitations grant no company/platform role. All protected account guards include the removed flag. Existing records are preserved; pending company links are revoked on removal.
- Added desktop hover/focus and touch-friendly ⓘ descriptions, announcement/registration-switch explanations, a short shareholder introduction and three-step overview, and locally embedded official network marks with recorded sources.
- Isolated native-browser QA passed for company-member removal, pending-company-invitation revocation, campaign editing/delete/restore/open/archive, account invitation creation/removal and restore-dialog wording, tooltip dialogs and shareholder introduction. Desktop and 390px checks have no page-level horizontal overflow. The isolated QA server was stopped; the primary localhost server remains running with the original database.
- Production source `92f9407` is Ready (deployment `3svZwp56d94b8d6Cda2d6ab2M8ns`). Live Postgres/browser verification passed for creating and revoking a synthetic account invitation, draft creation/editing/deletion/restoration, opening registration, restricted published editing, archiving and persistence after reload. The dedicated synthetic campaign remains archived inside the hidden Portal Review QA company, with zero registrations and no funding or transfers.
- Live company-member Change role/Remove controls, account Add account/Remove portal access controls, clickable registration-setting help, the shareholder introduction and all three loaded official network images were checked. Both original accounts remain active and the existing Viewer membership is retained. No existing campaign, balance or permission was changed by the verification.

## Holding evidence and approved logo — 2026-11-11

- Added private shareholder evidence upload, immutable versions, needs-information/rejection follow-up, reasoned manual approval and reviewer history. New registrations use document upload in the hosted portal; earlier demo registrations remain intact. Company Owner/Admin/Operator reviewers can read only their own company's evidence. Viewers and platform staff without the company reviewer role cannot read it. Self review is blocked.
- Additive migration `0004_holding_evidence.sql` runs on Neon and SQLite. Files are limited to PDF/PNG/JPEG, 2 MB each and 10 versions per registration. Existing internal staff company files retain their original separate permissions. No file bytes or filenames appear in workspace/public JSON or audits.
- State, version, review and team audit commit atomically. Stale versions, lost access, suspended accounts/companies, campaign pauses and locked snapshots block changes. Pending/needs-information registrations block snapshots. New-registration pause does not block requested follow-up. Approval checks record-date equality, date not in the future, whole shares/minimum and reviewer attestation.
- Applied a scalable transparent SVG adaptation of the approved pine/sage double-C concept to the shared logo and favicon. Hero artwork, horizontal public campaigns and existing data are preserved.
- Isolated browser QA completed with two synthetic PDFs: submit 1,000 shares → request more information → resubmit 1,200 shares → approve → demo wallet → lock 120 TEST allocation. Both versions/reasons persist after reload. No funds or transfers were created. The 390px review dialog has no horizontal overflow and browser error logs are empty.
- Real uploads/manual eligibility review are implemented; third-party identity/holdings verification, wallet control and on-chain payouts remain unfinished. No real identity documents or broker credentials were used.
- All 87 tests pass, including additive migration preservation and the authenticated cloud handler. Build/asset and whitespace checks pass. Production deployment checks are recorded after release.
