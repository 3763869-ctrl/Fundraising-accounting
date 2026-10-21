# Cedar & Olive: scope and remaining work

Original branding/design. DonorFuse was supplied as a functional reference; its private screens were not accessible. No proprietary source or assets were copied.

## Working fundraising workflows

- Dashboard with period filters, daily/weekly/monthly groups, bar/line charts, pledge/payment comparisons, fundraiser totals, fund balances, failed/pending payment and overdue-task alerts.
- Collapsible navigation, sortable/searchable/filterable tables, per-browser saved views, custom columns, bulk selection for XLSX export, pagination, and Add New actions. Print reports contain all rows selected by report controls, independently of the table's search/page.
- Donor creation/editing, titles, English/Hebrew names, email/phone collections, personal/business addresses, tags, notes, occasions, custom fields, fundraiser assignment, receipt language, linked accounts, lists, and activity history.
- Private donor attachments (PDF/PNG/JPEG/text, 5 MB). Live files use a private Supabase Storage bucket and expiring signed downloads; sample files remain in browser storage.
- Campaigns/funds, fundraisers, sponsorship definitions/capacity, dated sponsorship pledges, events, and linked donations.
- Pledges with campaign/fundraiser/event/sponsorship, dates, description, receipt preference and expected payment type. Paid, scheduled and open balances derive from allocations, not duplicate counters.
- Manual individual/batch payment records, pending/failed/processed/undeposited views, pending-resolution actions, allocations across multiple pledges, and explicit donor-credit application. API payment entry uses the same database function. No entry action charges a card or initiates a transfer.
- Finite installment and recurring plans (1–120 payments), exact cent splitting, month-end handling, fulfillment, completion, pause/resume/cancel. These are repeated plans, not auto-renewing subscriptions; provider collection is not connected.
- Numbered acknowledgment snapshots, Hebrew RTL, custom plain-text acknowledgment versions with placeholders, print/Save PDF. Sample acknowledgments are clearly marked. No email/SMS is sent, and official US tax receipt disclosures still require organization review.
- Pledge/payment detail, open balances, campaign/fundraiser/expected-method summaries, forecasts, Excel and PDF-through-printing.
- Gregorian/Hebrew calendar, diaspora holidays and weekly parshah. Holidays start the preceding evening; no location-specific candle-lighting calculation. Tasks and events are editable/recordable; tasks can be completed/reopened.

## Working accounting workflows

- Chart of accounts and an immutable, balanced general ledger. Deferred database constraints validate balance; client roles cannot directly write journal records. Corrections use reversing entries.
- Processed payments debit Undeposited funds and credit donor-credit liability. Allocations debit donor credit and credit contribution income, or receivables when the pledge was explicitly recognized.
- Pledges are commitments by default. An accountant can explicitly recognize the unpaid portion of an unconditional pledge as receivable/income. Conditional pledges should remain unrecognized.
- Deposits debit a bank asset and credit Undeposited funds; they never create donation revenue again. Only processed undeposited payments can be deposited, once. Deposits use gross amounts; fees are recorded separately.
- Vendor records, invoice-based bills, accounts payable, partial bill payments, duplicate-check-number and overpayment prevention.
- Print-ready check payment vouchers with bank/payee/memo/amount/check number. These are **not negotiable checks**. Bank-approved stock, MICR details, signatures, and calibrated check layouts still need setup.
- Generic bank CSV import (external_id, transaction_date, description, signed amount), duplicate prevention, invalid-row counts/errors, match-existing or create-new workflows. A match creates no new ledger entry. Chase-specific mapping and automatic feeds are not connected.
- Statement reconciliations, previous balances, cleared-entry selection, zero-difference completion, reconciliation history, prevention of reusing cleared entries, and backdating protection for reconciled bank periods.
- Accrual/cash profit-and-loss reports, balance sheets, running account transactions, vendor balances, fund activity filters, printing/Save PDF, and numeric Excel exports. Cash reports use received allocations/paid bills and exclude receivable/payable balances. Banks are pooled; tagged fund activity is not a complete automated restricted-fund release/control system.

## Working internal operations

- Organization name, Hebrew name, EIN/timezone settings and funds. USD/US defaults are fixed in this release. Custom organization logo upload is pending.
- Email-bound, verified-account, single-use seven-day invitations. Tokens are stored hashed; links are shared manually, not emailed. Owner/admin/fundraiser/accountant/viewer permissions and last-owner protection are enforced in the database. Users with multiple memberships can switch organizations.
- Typed donor custom-field definitions with database validation. Broad module enable/disable configuration is not implemented.
- One functional automation: failed-payment record + minimum-amount condition → high-priority donor follow-up task, with success/error logs. Rules can be disabled/enabled. Rules execute synchronously in the database, not in a background worker.
- Device registration and gateway-account metadata, always labeled Setup required. No credentials/card numbers are collected.
- Versioned notification preferences and scheduling/retry settings are stored but do not trigger unconnected email, SMS, or payment workers.
- API documentation at `/api`; authenticated read resources and manual payment-record POST under `/api/v1`. Uses validated Supabase user tokens and RLS, not service-role access. Provider webhook monitoring has a data model/UI but no provider adapter is active.
- Bank import run counts and row errors are recorded. Browser XLSX downloads work; comprehensive export audit history is pending.

## External setup and remaining product work

The Supabase project and migrations are configured, and the app is deployed on Vercel. The owner confirmed sign-in works. Live Storage and provider behavior still require owner-operated validation; a local/test success alone does not prove them.

Sola (formerly Cardknox) is identified, with the owner-operated one-time card flow documented in LIVE_PAYMENTS.md. Merchant activation and actual provider validation remain subject to the setup described there. Matbeya/OJZ/other charity-card capabilities are pending the owner's research. Chase requires a chosen bank connector and consent or an agreed CSV mapping. External integrations beyond the owner-operated Sola flow still require activation; sample records are never seeded into production.

Public campaign donation links, signed/idempotent provider webhooks, automatic installments/retries, gateway refunds/voids, processing-fee rules, outbound receipts/reminders/summaries, real device connectivity, background worker scheduling, invoice/statement template editors, and expired tokenized-method reporting remain integration/product milestones. Automatic fund-restriction releases need the organization's accounting policy. Backups, recovery, retention/scanning of uploads, high-volume server-side reporting and production monitoring also need operational validation.

## Data separation and validation

`/demo` uses a separate synthetic IndexedDB database and Web Locks for atomic cross-tab edits. Reset affects only local sample records. It never seeds Supabase. `/dashboard` validates the Supabase user and loads organization-scoped data; RLS/functions enforce live permissions. The retained historical Python prototype is not used by the web app or ledger.

Tests apply real migrations to embedded PostgreSQL with Auth/Storage fixtures, check financial rules and permissions, and exercise browser workflows, persistence, Hebrew print output, XLSX, attachments and mobile navigation. Hosted Supabase email/Storage and provider-specific behavior still require live validation. Source is published to GitHub and the app is deployed to Vercel.

## Owner-operated Sola card-entry addition

A server-authorized, one-time live card-entry flow opens inline when Credit card is selected in New payment (with `/payments/card` retained as an optional direct route), with hosted iFields, persisted single-submit attempts, server-only result finalization, exact approval amounts and uncertain-outcome lockout. See LIVE_PAYMENTS.md for activation prerequisites and current limitations. It does not implement 3DS challenge completion, refunds, recurring processing, provider webhooks or settlement automation. No real provider transaction has been submitted or claimed as tested.

The inline flow supports opt-in saved cards backed by encrypted Sola tokens. Donor profiles can save a card without a charge. Cash payments support audited local voids, receipt invalidation and pledge/plan reopening, with suspense review for deposited cash. No provider charge, card save or cash void has been submitted by the agent.
