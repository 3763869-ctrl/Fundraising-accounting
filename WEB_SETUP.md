# Web setup — United States / USD

## Development and sample mode

Use Node.js 24. From `/workspace/Fundraising-accounting` run `npm ci`, then `npm run dev`. The app listens on loopback port 3000. Its homepage links to `/demo`, a fully separate browser IndexedDB sample database. Enable browser storage and use a modern browser supporting Web Locks. Sample payments never connect to a provider. Reset only replaces the sample organization's local data.

## Supabase project

1. The organization owner creates a Supabase account/project in an appropriate US region.
2. Apply every SQL file in `supabase/migrations/` in filename order through the SQL editor or your standard Supabase migration workflow. Run each migration once. The migrations create fundraising/payment functions, contact-management/audit triggers, private attachment storage, balanced accounting/bank workflows, invitations/operations, sponsorship constraints, pending-payment resolution and typed custom fields. Apply all ten in order.
3. Copy `.env.example` to `.env.local` and populate `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These are public project settings. Never put a service-role key into a public variable. Restart the dev server after changes.
4. Enable email/password authentication and email confirmation. Set minimum password length to 12 in Supabase Auth. Configure production email delivery before inviting real users.
5. Set the Auth Site URL to the deployment's actual origin and configure appropriate redirect URLs. The Confirm Signup email template must link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`. Use a separate development Supabase project/origin for development emails and preview deployments.
6. Create an account, confirm email, sign in, and create your organization. The organization defaults to US/USD and the creator becomes its owner atomically. The live organization starts empty.
7. Verify the private `donor-attachments` bucket exists with the supplied policies. Test uploads and signed downloads with two accounts in separate organizations. Storage object policies require hosted Supabase; embedded database tests exercise metadata isolation but not actual object storage.

Apply the new migrations to any project that previously received only the initial foundation migration; do not rerun the first migration or drop existing user data. The fundraising migration adds new non-null fields using safe defaults for existing records. No destructive reset is required.

## GitHub and Vercel

1. The application source is committed and uploaded to the `main` branch of `3763869-ctrl/Fundraising-accounting`. Git push and the remote commit were verified. Connect this repository and branch when importing into Vercel.
2. Connect the repository to a Vercel project: Next.js framework, repository root, `npm run build`, Node 24. A custom domain is optional; use the assigned Vercel hostname initially.
3. Configure both Supabase public variables on the relevant Vercel environment and redeploy. Public variables are read at build time. Keep preview and production Supabase projects separate.
4. Set Supabase's Site URL to the final Vercel origin and test confirmation there. The Vercel deployment can serve sample mode without Supabase; live signup/records require the connection and migrations.

The Vercel project `zev1/cedar-olive` is connected to this GitHub repository and deployed at https://cedar-olive.vercel.app. Public sample review is available at `/demo`; hosted Supabase setup remains pending. Temporary CLI authentication uses XDG directories under /tmp/fundraising-vercel. Never save device codes, passwords, or tokens in the repository. Do not assume authentication survives an environment snapshot. Saving environment configuration does not publish or deploy the app.

## Verification

```sh
npm test
npm run build
npm run typecheck
E2E_PRODUCTION=1 npm run test:e2e
```

The browser runner starts a local server on port 3100 and uses the trusted npm-distributed Chromium binary from `@sparticuz/chromium`. It needs writable `/tmp`; no system browser installation is required. Standard Playwright browser downloads were blocked by this environment's policy. Tests are designed for this Linux cloud machine; use your installed Playwright Chromium and adjust `launchOptions` when running on another platform.

Database tests apply all migrations to embedded PostgreSQL (PGlite), with an Auth identity fixture. They cover isolation, role restrictions, allocation bounds, same-donor enforcement, idempotency, batch rollback, exact cent installment distribution, month-end dates, schedule fulfillment, and receipt snapshots. Browser tests exercise real forms and IndexedDB persistence, Hebrew output, attachment downloads, Excel export, saved views, columns, and mobile navigation.

Hosted validation still required: email/signup/signin/signout, organization creation, donor/pledge/payment/schedule workflows, role restrictions through direct API requests, private attachment storage, and independent accounts demonstrating organization isolation. No live card or bank test can run before provider sandbox setup.

## Product status

See [PHASES.md](PHASES.md). Connected fundraising, core accounting/reconciliation, and internal operations are implemented. Acknowledgments are print-ready but require organization-approved tax wording before use as official charitable receipts. Pledges are not automatically recognized as accounting income. Only an explicitly confirmed unconditional pledge is posted to receivables; received allocations otherwise recognize contributions. Deposits transfer assets without duplicating revenue. The owner-operated Sola card flow is documented in LIVE_PAYMENTS.md. Charity-card-specific adapters, Chase, live devices, public giving pages, external webhooks, scheduled collections, and outbound messaging remain pending. Failed-payment-to-task rules work inside the database. Preferences and setup metadata alone do not activate external services.

## Donor form revision

Apply `202610200011_donor_details.sql` in migration order before using the revised live donor form. It adds structured names, labeled phone/email contacts with explicit consent flags, and active status without replacing legacy contact arrays or display names. Primary/business addresses retain their structured components in the existing addresses column. Add/Edit Donor opens only Donor Details; optional sections remain collapsed. Consent flags record permission and do not initiate messaging. Existing attachments remain managed from saved donor details.

## Live Sola entry

See [LIVE_PAYMENTS.md](LIVE_PAYMENTS.md) for the owner-operated `/payments/card` workflow, server-only credentials, merchant binding, accounting safeguards and remaining Supabase Auth dashboard steps. Apply `202610200012_sola_live_payments.sql` in order on other environments. This flow is separate from `/demo` and the sandbox secure-field check. Provider transactions have not been exercised with real credentials by the agent.
