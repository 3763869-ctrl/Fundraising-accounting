# Fundora

A nonprofit and synagogue workspace built with **Next.js, Supabase, and TypeScript**, intended for Vercel. United States / USD. Original branding and interface, based on the requested DonorFuse-style functional structure.

## Run

Use Node.js 24. From the repository root:

```sh
npm ci
npm run dev
```

The homepage links to an interactive **sample workspace** at `/demo`. Synthetic records persist in this browser's IndexedDB database. Sample mode does not need Supabase and does not write to production. All sample payments are manual records; no charge is initiated.

For a live organization, configure Supabase following [WEB_SETUP.md](WEB_SETUP.md), apply all SQL migrations in filename order, and use `/login` followed by `/dashboard`. No sample data is copied into the live database.

## Implemented workflows

Donors and accounts, lists, campaigns/funds, pledges, manual payments and atomic batches, payment allocations, donor credit, finite payment schedules, printable English/Hebrew acknowledgments, basic fundraising reports/XLSX export, tasks/history, and a Hebrew/Gregorian calendar. Searchable tables include filters, sorting, saved views, columns, selection, and pagination. Donor information and organization settings can be edited.

The app also includes a balanced ledger, deposits, vendor bills/payments, bank CSV import/matching, reconciliation, cash/accrual reports, user invitations/roles, typed custom fields, failed-payment task automation, and an authenticated API. **Owner-operated Sola card entry requires the setup in [LIVE_PAYMENTS.md](LIVE_PAYMENTS.md); other external integrations remain pending.** Check printing currently produces non-negotiable vouchers; automatic fund restrictions, refunds and provider settlement are later milestones. Payment-provider credentials must be stored by provider tokenization when integrations are implemented. See [PHASES.md](PHASES.md) for implemented behavior, precise limitations, and the remaining roadmap.

## Validate

```sh
npm test
npm run build
npm run typecheck
npm run test:e2e
```

Database tests use embedded PostgreSQL and test real migration functions and policies with an Auth fixture. Browser tests use bundled Chromium via `@sparticuz/chromium`, suitable for this Linux environment, and start a local server on port 3100. Test artifacts are ignored in `test-results/`. Hosted Supabase authentication, email delivery, and Storage still require live validation.

The `uuid` override preserves ExcelJS's CommonJS v4 API while selecting a patched dependency version; the XLSX download is exercised by browser tests.

The `fundraising/` Python app and `tests/test_foundation.py` are retained from the initial local prototype. They are superseded and are not the Vercel backend or the web app's accounting system.

Matbia charity-card setup and sandbox separation: see [MATBIA_SETUP.md](MATBIA_SETUP.md). Live Matbia processing remains disabled pending provider activation.
