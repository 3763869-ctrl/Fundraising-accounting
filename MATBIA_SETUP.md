# Matbia integration and activation

## Current scope

New payment → Charity card → Matbia is implemented. One-time live charges are prepared behind server-only activation gates. The sample workspace offers clearly labeled simulations for approval, decline and unknown-response recovery; it never calls Matbia or writes financial records into Supabase. Real provider sandbox verification is a separate, explicitly enabled build check with Matbia's published test organization/cards and an ephemeral PostgreSQL database.

No production Matbia credential or organization handle was copied from chat/screenshots into source or settings. No live Matbia charge, refund, void, verification or schedule was submitted by the agent.

## Server-side configuration

- `MATBIA_API_TOKEN`: Matbia's production validation token, sent directly in Authorization without a Bearer prefix. Sensitive/Production setting only.
- `MATBIA_ORG_USER_HANDLE`: the organization's Matbia profile API key. A separate recipient identifier, not the authorization token. Sensitive/Production setting only.
- `MATBIA_OWNER_EMAIL`: confirmed application owner allowed to connect the merchant and submit payments. Falls back to the already configured `SOLA_OWNER_EMAIL` if omitted.
- `MATBIA_LIVE_PAYMENTS_ENABLED=false`: keep false until provider setup and owner-operated validation are ready.
- `MATBIA_DIRECT_ENTRY_APPROVED=false`: require Matbia's confirmation of the documented direct card-entry approach before exposing card inputs. No Matbia hosted-field or tokenization contract has been supplied.
- `MATBIA_MAX_CHARGE_MINOR=10000`: initial $100 server-enforced limit.
- Existing server-only Supabase credentials support binding and finalization. Matbia does not reuse Sola's merchant API key, iFields key, tokens or card vault.

Only the verified owner can bind one organization to these deployment credentials, and that person must own the organization. The merchant binding cannot be reassigned from the browser. Ordinary organization members cannot submit charges with these credentials. No arbitrary client URLs or caller-supplied API tokens are accepted. Production and sandbox hosts are fixed in the adapter; published sandbox credentials/cards are rejected by the live path.

## Accounting and uncertainty

The server validates the donor, campaign, amount, allocation list, open pledge balances, plan reservations and explicit cardholder permission. Leaving open pledges unapplied requires confirmation. PostgreSQL reserves an immutable request UUID and a pending payment before the outgoing call. Reusing the UUID returns the saved result; changing its intent is rejected. Sending/unknown attempts block another attempt for that donor. There are no automatic retries or duplicate overrides. The same UUID is sent as externalTransactionId with allowDuplicates=false.

Only the privileged server function can finalize a provider response. Confirmed Success requires an empty/null error and a valid provider reference. Definitive Declined responses and the exact documented invalid-card, invalid-expiration, expired-card and insufficient-wallet-balance business errors are treated as declines. The sandbox’s HTTP 406 with an explicit Declined response is recognized as a decline. Generic Error/Failed, duplicate responses, timeouts, other HTTP errors, malformed JSON and contradictory approvals stay pending for review; they never mark pledges paid. The operator must check Matbia before another action. No lookup/webhook contract has been supplied, so automatic reconciliation of uncertain results is not implemented.

Approved funds post balanced accounting entries and pledge allocations once; excess remains donor credit. If a pledge changes during the gateway call, approved money is preserved as credit and flagged for allocation review. Declines leave paid totals unchanged. The manual pending-payment resolver cannot fabricate a Matbia approval. Provider references are retained with the payment and acknowledgment.

## Card handling

Live card fields remain absent until all production gates and binding are satisfied. The documented API uses a Matbia card number and MMYY expiration, not Sola iFields. Card numbers are transient password-input refs, excluded from generic form metadata and cleared immediately on submission. The API never persists/logs raw cards or expiration, and never sends them back in responses. Browser/session storage holds only non-sensitive attempt UUIDs. No CVV is requested. Saved Matbia cards are not implemented without a provider-approved tokenization contract.

## Validation

`npm test` includes mock transport/timeout checks, sample-ledger workflows and all migrations in embedded PostgreSQL, with organization isolation, service-only finalization, duplicate reservation and unknown-result lockout. Playwright exercises sample approval/decline/reload recovery, existing Sola inline payment, and signed-out endpoint rejection.

`MATBIA_VERIFY_SANDBOX=1 npm run build` additionally calls ONLY https://sandbox.api.matbia.org with the public sandbox token, organization and card fixtures. That flag should be a one-off build argument, never a persistent Production setting. The check creates its database in memory, verifies a $100 pledge becomes $75 after a $25 approval, verifies a declined fixture changes no paid totals, confirms local replay sends no second request, and checks the ledger balances. It reads no production Matbia token and never uses the production Matbia host. Ordinary builds do not make provider payment requests.

The cloud workspace's proxy blocks Matbia hosts; Vercel's build environment can reach them. Provider sandbox and public error-reference checks therefore run in separate preview builds. Verified sandbox results: the funded fixture was approved and reduced the isolated pledge from $100 to $75; the insufficient-wallet fixture returned HTTP 406 / Declined and left the pledge balance unchanged; replay was blocked in both cases. These are not live merchant/key-pairing tests. Sandbox reference: developers.matbia.org/testData/; business-error definitions were also read directly from developers.matbia.org/errors/ through a read-only build check.

## Provider handoff

Request the production validation token after sandbox verification, and ask Matbia to confirm the approved card-entry handling for the documented cardNum API. Enter both production credentials directly into secure Vercel settings. Confirm the organization, configure the gates deliberately, connect its merchant binding, and have the owner submit the first small live payment. Do not use production cards in sandbox tests or create a schedule as a setup check.

Void/refund, recurring schedules, saved Matbia cards, automatic webhook/settlement processing and terminal support remain separate work. The presence of those endpoints in supplied documentation does not authorize calling them.
