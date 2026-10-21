# Plaid Sandbox bank feed

The first Plaid phase is deliberately Sandbox-only. It supports connecting a simulated Chase institution, fetching Transactions Sync changes, and disconnecting the simulated item. No Link login, real Chase connection, Production host, money movement, bank matching, or financial posting is enabled by this adapter.

## Secure configuration

Set these server-only, sensitive Production environment variables in Vercel (Production is the website deployment target, not Plaid's API environment):

- `PLAID_CLIENT_ID`: the Plaid developer client ID.
- `PLAID_SANDBOX_SECRET`: the Sandbox secret.
- `PLAID_TOKEN_ENCRYPTION_KEY`: an independent 32-byte encryption key encoded as 64 hex characters. Generated securely during setup. Preserve it while encrypted bank tokens exist.
- Optional `PLAID_OWNER_EMAIL`: verified owner permitted to use these credentials; defaults to the established `SOLA_OWNER_EMAIL`.

No `NEXT_PUBLIC_` Plaid credential exists. Any stored Production secret is unused. The host is fixed to `https://sandbox.plaid.com`, access tokens must have the Sandbox prefix, and request bodies cannot select another environment or host. No IP allow-list or webhook URL is required for the manual Sandbox sync phase.

## Usage and isolation

Sign in as the verified organization owner and open Accounting → Bank Feed → Plaid Sandbox → Connect simulated Chase. The server locates Chase in Sandbox, creates a simulated Transactions item, exchanges its public token on the server, and stores its access token with AES-256-GCM encryption bound to the organization and connection UUID. Only opaque identifiers and transaction display fields reach the UI; the browser never receives the access token or developer credentials.

Sandbox metadata and transactions live in `plaid_sandbox_connections` and `plaid_sandbox_transactions`; token/cursor state lives in the private `plaid_sandbox_secrets` table. Browser writes and reads of secrets are denied. An operation lease prevents overlapping connect/sync/disconnect requests. Sync buffers the full pagination batch before atomically updating entries and cursor with a version check. Pagination mutation errors restart from the original saved cursor. Modified and removed transactions update prior entries; posted transactions supersede their pending predecessors. Duplicate imports are upserts, not new financial events.

These tables are excluded from live workspace financial table loading and never write `bank_transactions`, journals, donor payments, or reconciliation rows. The UI displays the newest 100 active Sandbox transactions with search, pagination, column settings, and clearly labeled exports. Positive Plaid amounts mean spent; negative amounts mean received. USD transactions only are supported in this stage.

Sync is manual; if the Transactions product is still preparing data, select Sync again shortly. Disconnect removes the simulated provider item and cascades its local Sandbox records. The browser-only demo never calls Plaid.

## Verification

Unit/SQL tests cover fixed Sandbox transport, token encryption and context binding, pagination restart, atomic cursor updates, duplicate/version checks, pending-to-posted handling, organization isolation, secret protection, and absence of live ledger/bank-feed writes. Browser checks cover demo isolation and unauthorized endpoint rejection.

`PLAID_VERIFY_SANDBOX=1 npm run build` is an optional one-off remote build check. It creates a temporary simulated Chase item, reads sample Transactions data, and removes the item in cleanup. It never writes the app database. Ordinary builds make no Plaid calls. Setup verification successfully received 17 Sandbox transactions and removed its temporary connection.

## Later Production phase

Production is separate work: implement Plaid Link and Chase/OAuth consent, configure its approved redirect URLs, add verified webhook handling and background syncing, explicitly map linked accounts to accounting bank accounts, and match existing deposits/payments before creating any entries. Trial approval and a stored Production secret do not activate this phase. Real bank linking remains user-operated.
