# Sola / Cardknox integration

See [LIVE_PAYMENTS.md](LIVE_PAYMENTS.md) for the owner-operated live card workflow, activation prerequisites and current limits. The owner authorized preparing live entry, while explicitly reserving submission of any actual charge to themselves. No real transaction was submitted by the agent.

## Credential separation

- `SOLA_API_KEY`: live merchant Standard API key; Sensitive and Production only in Vercel. Read only by the authenticated server transaction route. Never use a NEXT_PUBLIC prefix, put it in gateway metadata or expose it in client props/logs.
- `NEXT_PUBLIC_SOLA_IFIELDS_KEY`: the separate browser-safe live iFields key, as documented in the supplied guide. Production only; where supported restrict to https://cedar-olive.vercel.app. It must match the live merchant account.
- `SUPABASE_SERVICE_ROLE_KEY`: Sensitive and Production only. Used by the server for merchant binding and verified provider-result finalization; never accepted from a browser request.
- `SOLA_OWNER_EMAIL`: verified app owner permitted to bind the merchant and use live entry. Other organization owners cannot claim these credentials.
- `SOLA_LIVE_PAYMENTS_ENABLED`: production feature gate. A verified owner and persisted organization binding are still mandatory even when true.
- `SOLA_MAX_CHARGE_MINOR`: server-enforced limit in USD cents, initially 10000 ($100).

Sola's reported Standard permissions include payments/reports/customers/recurring but exclude refunds/credits/voids/user administration. Only the `cc:sale` operation is implemented. Reported permissions and matching live keys have not been independently verified by a real transaction. The blank IP allow-list is separate from iFields origin restrictions; a website's public IP is not Vercel's outbound IP.

## Supplied contracts

The owner supplied Introduction, iFields and Transaction API text. These document hosted card-number/CVV iframes, `setAccount`, `getTokens`, separate SUTs submitted as xCardNum/xCVV, and the server-only gatewayjson endpoint. Approval requires xResult=A, matching xAuthAmount and a provider reference. SUTs are not reusable xToken values; no reusable card or CVV data is stored by this implementation.

No full request/response or header logging is enabled, despite that suggestion in the introduction. No duplicate override, automatic retry, failover, card save, customer creation, refund, void or recurring command is used. A response requiring 3DS challenge completion remains pending for manual review; that follow-up flow is not implemented. Command-specific credit-card/3DS documentation will be needed for expanding support.

The SDK is pinned to 2.15.2309.2601, the version referenced by the official @cardknox/react-ifields 2.2.86 README inspected from npm. It is not claimed to be the latest. The React wrapper's declared React 18 dependency conflicts with this app's React 19 runtime, so the supplied vanilla SDK interface is used. Optional deployment preflight checks verify public SDK/frame availability and the credential-free gateway status endpoint; they never submit a transaction.

## Separate sandbox check

`/settings/sola` also supports a non-charging sandbox tokenization check, independent of live entry. It requires a separate non-production Supabase project, a signed-in owner/admin of `SOLA_SANDBOX_ORGANIZATION_ID`, `SOLA_SANDBOX_ENABLED=true` and a separate `SOLA_SANDBOX_IFIELDS_KEY`. It runs only in Preview or local development; Production always disables this sandbox check. The key must actually be from a sandbox account; key text alone cannot prove that.

The sandbox check requests SUTs only on the administrator's action and immediately discards both tokens without sending them to an application payment endpoint. It does not prove live merchant permissions or live key pairing. Existing live keys must never be placed in sandbox slots.

Automated tests use synthetic tokens and injected provider transports; browser harnesses mock both SDK and payment API without production credentials. Actual provider tokenization/processing has not been exercised by the agent. See LIVE_PAYMENTS.md for remaining hosted Auth setup and owner signup steps.
