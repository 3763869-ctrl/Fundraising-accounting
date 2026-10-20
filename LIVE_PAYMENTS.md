# Live Sola card-entry operation

The owner authorized preparing live processing, but instructed the agent not to submit charges. The agent has not invoked a live transaction, card save, customer write, refund, void or recurring operation. Provider calls in automated tests use injected mock transports and synthetic nonces only.

## Deployment and identity

The production app is https://cedar-olive.vercel.app. `/payments/card` is the live entry route. It requires a signed-in, email-confirmed user matching server-only `SOLA_OWNER_EMAIL`, and owner/admin membership of the organization in the singleton `sola_merchant_binding`. Only that verified email can use the owner-only Connect Organization flow, and the database permits binding only an organization the user owns. Binding cannot be reassigned from the browser. A production-only `SOLA_LIVE_PAYMENTS_ENABLED` flag and required backend settings also gate processing. Initial server-enforced limit is $100 per charge (`SOLA_MAX_CHARGE_MINOR=10000`).

`SOLA_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are Sensitive/Production-only server credentials. They must never enter client code, props, logs, screenshots or source control. The separate `NEXT_PUBLIC_SOLA_IFIELDS_KEY` is browser-safe per the supplied iFields guide, and must belong to the same merchant account as the private API key. Where supported, restrict it to the exact production origin. No live key belongs in Preview or sandbox settings.

## Actual card workflow

1. Sign up, confirm email, sign in and create the synagogue organization. Edit organization details before issuing official receipts; tax wording and tax ID still require owner review.
2. Add the real donor in the live workspace. Synthetic `/demo` records are never imported into production.
3. Open `/payments/card` and connect the organization to the configured Sola merchant once. Only the verified merchant-owner email can do this.
4. Select the donor, amount and card expiration. Card number/CVV are collected only in Sola-hosted iframes. Check cardholder permission, then deliberately press Charge. No agent will press this button.
5. An approved payment is posted once to the ledger and initially retained as donor credit. Open Payments, allocate it to pledges, and create an acknowledgment using the existing workflow. Do not also enter the same charge as a manual external-card payment.

The form uses the pinned iFields SDK documented in SOLA_SETUP.md, separate card/CVV SUTs and the supplied Transaction API's `gatewayjson` endpoint with `cc:sale`. It sends `xVersion=5.0.0`, software identification, exact USD amount, expiration and a stable UUID invoice. No raw PAN/CVV reaches app-owned inputs or the database. Tokens remain in memory only, hidden nonce inputs are cleared immediately, and the server returns only sanitized status/reference/record identifiers. Reusable xToken/card-on-file data is not saved.

## Duplicate prevention and uncertainty

Before an outbound provider request, PostgreSQL durably prepares a pending payment and a single-submit attempt under a donor row lock. The same request key never causes a second outgoing request. Pending/unknown attempts block another attempt for that donor. Browser session storage retains only the UUID so reloading checks saved status instead of resending a charge. The application never retries or fails over a transaction automatically and never requests duplicate override.

Approval requires `xResult=A`, exact matching `xAuthAmount` and a valid provider reference. Only a service-role-only database function may finalize the result; browser roles cannot fabricate approval or manually resolve a provider-pending payment through the manual-payment function. Finalization atomically records payment status and balanced journal entries. If pledge allocations changed while processing, the received money remains recorded as donor credit and is flagged for allocation review.

Definitive declines become failed payments. Network/HTTP errors, malformed responses, partial/missing approval amounts, duplicate errors and 3DS challenge responses remain pending for manual review. **3DS challenge completion is not implemented.** A saved request is not proof that funds were received. If a response is uncertain, check the Sola portal before taking any further action. Admin/support database reconciliation may be needed; no browser override or automatic retry is provided. If an approval reached Sola but bookkeeping failed, the durable pending attempt remains; never start a second charge to fix accounting. Refunds/voids are excluded by the reported key permissions and are not implemented.

## Hosted setup status and required owner steps

All 12 migrations were applied to project `fqlimyxbutfkskwzroxt` and recorded in migration history. No donor, payment or demo rows were seeded. Hosted privilege checks confirmed authenticated users cannot execute the provider-finalization function and the server role can. The public Supabase project settings and privileged server key were configured on Vercel Production without displaying credential values.

The Supabase management token can access SQL and read Auth configuration, but changing Auth configuration returned `403 Missing required permission(s): project_admin_write`. Its current Site URL was `http://localhost:3000`. This is an account-setup blocker, not proof of a code defect. The owner must update the following in the Supabase dashboard (or provide the appropriate management scope through secure account settings):

- Auth → URL Configuration: Site URL `https://cedar-olive.vercel.app`; allow redirect `https://cedar-olive.vercel.app/auth/confirm`.
- Auth → Email Templates → Confirm signup: use `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm email</a>`.
- Keep email confirmation enabled; use at least 12 characters for app passwords. The app enforces this length, but the attempted management update of the provider password policy was also blocked by the missing scope.

Then register the owner email, confirm it, and create the organization. Do not bypass email confirmation or use production fake identities for tests. The owner account did not yet exist at the setup inspection. The merchant remains unbound until the verified owner completes that flow, so no live card is accepted before setup is complete.

The supplied documents establish request and response contracts; actual merchant permissions, live key pairing, provider-hosted field loading and first live approval have not been validated with a real card. No successful-charge claim is made. Test failures, timeouts and duplicates were exercised with mocks/embedded PostgreSQL. Automated settlements, fee posting, provider webhooks, card-on-file, refunds and recurring billing remain outside this first owner-operated payment flow.
