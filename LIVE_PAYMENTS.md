# Owner-operated Sola payments and saved cards

The user reserves all real charge and card-save submissions to themselves. The agent has not submitted a real transaction, card save, refund, gateway void or recurring operation. Automated provider tests inject mock transports and synthetic tokens; embedded database tests never write sample records into production.

## Payment workflow

Open Pledges or Payments → New donation → New payment. Choose donor, amount and campaign, then apply open pledges manually or use exact-match/oldest-first selection. Leaving every open pledge unapplied requires confirmation. Selecting Credit card opens Sola-hosted card-number and CVV fields in that same form, with expiration and optional US ZIP. There is no second-page requirement. `/payments/card` remains an optional direct entry route.

The Charge button requires explicit permission for a single live charge. Initial server-enforced limit is $100. Only the email-confirmed account matching server-only `SOLA_OWNER_EMAIL`, with owner/admin membership of the singleton merchant-bound organization, may process cards. The inline setup panel can connect an organization owned by that verified user. Other organization owners cannot claim these merchant credentials. Production-only configuration is mandatory; sample mode loads no live fields or payment API.

Before any provider call, PostgreSQL durably reserves an attempt and pending payment under a donor lock. Requests use a stable UUID invoice, `cc:sale`, exact USD cents and the supplied iFields SUTs. Token-only charges load a donor-scoped saved-card record, decrypt its provider token on the server and send it as xToken; browser requests carry only the saved method ID. Active status, donor/organization binding and expiration are checked before charging.

Only the server role finalizes provider results. Approval requires xResult=A, a safe provider reference and an exact matching xAuthAmount. Approved funds and balanced journal entries persist even if an allocation changed during processing; such funds remain donor credit with a review flag. No manual entry should duplicate the same card charge.

## Saving cards

Save card to donor file starts unchecked and records separate cardholder storage consent. After a successful new-card charge, the server may retain the returned xToken if valid masked metadata is also present. Failure to save never turns an approved charge into a failed payment or asks for another charge. Donor profiles also offer Add card, a deliberate non-charging `cc:save` with its own durable attempt and consent. Saving does not authorize recurring payments or automatic future charges.

Sola holds the card. The app stores brand, last four, expiration, consent date and actor in `donor_payment_methods`. Reusable tokens are encrypted with AES-256-GCM in `sola_card_tokens`; organization, donor and method IDs are authenticated context. The independent `SOLA_CARD_VAULT_KEY` stays in Sensitive/Production server settings. Public/anonymous/authenticated roles cannot read the encrypted-token table or call persistence/finalization functions. The verified owner may list masked methods or remove a method from the app; removal disables it and deletes the app's ciphertext, without pretending to delete Sola's records.

Raw PAN and CVV stay in provider-hosted iframes. Single-use hidden nonce fields are cleared immediately after tokenization. Neither nonces nor reusable tokens enter browser storage, source control, logs, payment notes, receipt snapshots or client responses. Only non-sensitive attempt UUIDs survive reload. Do not rotate the vault key casually: existing cards must be re-encrypted under a controlled migration or re-entered by their cardholders.

## Uncertain responses

There are no automatic retries, failover, duplicate override, gateway refunds/voids or recurring requests. Unknown/sending attempts block another submission for that donor. Reload checks saved status rather than resending. A timeout, malformed/partial approval, duplicate error or 3DS challenge remains pending for operator review. 3DS challenge completion is not implemented. Check the Sola portal before another action; support-level bookkeeping reconciliation may be required. An API request or locally prepared record is not proof of receipt of funds.

## Cash voids

Void cash payment is a database correction, not a Sola operation or physical refund. It requires a reason and date, retains the payment and original receipt snapshot, archives allocations, reopens pledge/installment balances, marks receipts void and posts balanced reversal entries. Already deposited cash keeps the original bank deposit and reconciliation unchanged; a suspense liability and accounting review task record the unresolved cash correction. Cash-basis reports place original income and its reversal in their corresponding periods.

## Deployment and verification

Private merchant, privileged database and vault keys belong only in Sensitive/Production Vercel settings. The separate NEXT_PUBLIC_SOLA_IFIELDS_KEY is intentionally browser-safe and should be origin-restricted where supported. Live credentials must never be copied into Preview or sandbox settings. The public Supabase key must come from the selected project, not an unverified cloud binding.

Migrations through `202610210015_void_cash.sql` provide the required metadata, token isolation, attempts, permission checks and cash corrections. The owner has confirmed login works. Auth URL configuration should retain Site URL https://cedar-olive.vercel.app and allow https://cedar-olive.vercel.app/auth/confirm. The app supports Supabase's default PKCE confirmation callback as well as custom token-hash email links; email confirmation remains enabled.

Production preflight uses read-only requests to check the public SDK/frame, credential-free gateway health and Supabase connectivity. No real key-pairing, tokenization, card-save, saved-card charge or live approval is claimed from these checks. The first real end-to-end provider validation belongs to the owner.
