# Automated auth and login layout audit

Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` from `unifood-web`.
There is no separate typecheck script: `next build` checks TypeScript, including the browser tests.
Next development instances share a build lock; stop the normal server on 3000 before running
the isolated browser suite on 3100, then restore it with `npm run dev` from the monorepo root.

The browser suite uses only the loopback provider/backend in `tests/helpers/auth-provider-server.mjs`.
Auth admission goes through the actual Next BFF and Supabase SDK. Synthetic fixtures cover
incorrect credentials, unconfirmed email, role admission, refresh, reset, and provider/backend
failures. They do not verify Supabase's cryptographic token validation or contact a real account.
Backend JWT/authorization tests and the real migration/query tests cover those separate layers.
`npm test` runs PGlite and, when installed, an isolated temporary native PostgreSQL cluster.
No developer DB connection variables are used by those helpers.

`login-layout.spec.ts` checks geometry and compares six screenshots at 1366×768, 1920×1080,
and 390×844 for `/login` and `/panel/login`. The approved mobile panel hides its hero photo.
Baselines live in `tests/e2e/login-layout.spec.ts-snapshots/`; filenames identify the operating
system and apply to the configured Chromium/Edge browser. Screenshots use CSS pixel scale, hidden caret, disabled animations,
and omit only the Next development overlay. They contain empty fields and no account data.

The initial baselines are created with `npm run test:e2e -- --update-snapshots=missing`.
The installed Playwright reports a missing baseline as a failure while creating it;
inspect that initial image, then rerun the comparison against the saved baseline.
Subsequent verification uses plain `npm run test:e2e`, which compares existing baselines.
The configuration sets `updateSnapshots: "none"`, so a deleted or changed baseline fails.
Do not replace a changed baseline automatically: review the expected, actual, and diff images
in `test-results/`, report the change, and obtain visual approval before updating it.

The browser expiry tests deliberately age the synthetic SDK session cookie and exercise a real
SDK refresh through `proxy.ts`. Remember me is checked as cookie persistence; session cookies
still survive page reloads, and persistent cookies retain their expiry after refresh. Browser
restart/session restoration policy is outside the application's cookie contract.
