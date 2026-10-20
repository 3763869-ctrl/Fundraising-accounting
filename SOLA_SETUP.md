# Sola / Cardknox setup status

The owner identified the processor as Sola (formerly Cardknox). The owner reports a **live** Standard API key named “Fundraising and Accounting Software,” with payments, reports, customers and recurring permissions, without refunds, credits, voids or user administration. This description is not independent verification of provider permissions. The IP allow-list is blank; this does not establish domain restrictions or fixed outbound IP access. The owner subsequently created a separate iFields key. Vercel metadata verified SOLA_API_KEY as Sensitive/Production only and NEXT_PUBLIC_SOLA_IFIELDS_KEY as Production only; no values were read or displayed.

Inspection found only gateway metadata, manual payment entry and local schedules. A separate sandbox-only iFields setup check is now implemented at `/settings/sola`. There is no Sola payment adapter, provider customer creation, provider recurring creation or provider webhook handler. The designated names below are configuration conventions for the upcoming integration, not evidence that the integration is implemented. No credential values belong in this document, source control, logs, donor records or gateway metadata.

## Enter the live API key securely

1. Open https://vercel.com/zev1/cedar-olive/settings/environment-variables in your own signed-in browser.
2. Add `SOLA_API_KEY`. Paste the merchant API key directly into the Value input, mark it Sensitive, and select **Production only**. Do not send the value in chat or screenshots. If a value already exists, do not replace it without verifying its purpose.
3. Save it. Do not add the live key to Preview or Development. Those environments require separate provider sandbox credentials.
4. Saving a Vercel variable does not update an existing deployment. A later deployment will receive it. With the current code, no Sola operation consumes the variable and no processing is enabled.

`SOLA_API_KEY` must remain server-only: no `NEXT_PUBLIC_` prefix, client imports, serialized props, browser API responses or inclusion in `next.config`'s `env` object. Upcoming provider requests must run in an authenticated, organization-authorized server endpoint. A single deployment-wide merchant key must be explicitly bound to the synagogue's organization, not exposed to other organizations.

## Prepare secure card entry

1. Create a **separate iFields key** in Sola's merchant interface, using Sola's current iFields instructions. Do not reuse or publish the Standard API key.
2. Where supported, restrict the iFields key to the exact production origin `https://cedar-olive.vercel.app`. Do not authorize temporary/preview sites with the live key. Ask Sola to confirm the expected key type, allowed-domain format, iframe/script sources, SDK version and token lifetime/reuse rules.
3. Only after confirming that Sola designates it as a browser-safe iFields key, save that separate key as `NEXT_PUBLIC_SOLA_IFIELDS_KEY` in Vercel, Production only. This key is intentionally browser-visible; the merchant Standard key is not.
4. The app still needs Sola-hosted secure fields, confirmed origin/CSP settings, and a server integration. Card number and CVV must enter provider-hosted fields, never app-owned inputs or the database. The browser may send only the provider's opaque token and non-sensitive identifiers to the app server. Treat tokens as sensitive and do not log them. Confirm with Sola which tokens can be stored and reused before saving any payment method.
5. Implement and validate in a separate Sola sandbox first, with separate sandbox API/iFields keys, synthetic donors and a separate non-production database. Do not test the live key by making a charge, authorization, customer/payment-method write or recurring schedule.

## Before enabling live processing

Verify authentication and roles; explicit organization/merchant binding; server-calculated amounts; duplicate-submit protection and reconciliation of ambiguous timeouts; allocation/ledger consistency; signed or otherwise provider-verified payment notifications according to Sola's documented mechanism; masked payment-method display; and sanitized errors. Keep manual references distinct from processor-confirmed payments. Provider recurring operations and charges require the owner's explicit instruction. Refunds/credits/voids must remain unavailable under the reported permissions.

The blank IP allow-list does not imply Vercel has a fixed outbound IP. If Sola requires an IP restriction later, use a verified supported static-egress option; do not enter a deployment's public website IP as the server's outbound IP.

The official Cardknox documentation destinations attempted during this review were blocked by this execution environment's outbound proxy. The owner supplied the official guide text after these access failures. Actual provider behavior and account permissions remain unverified. No provider API request, charge or recurring creation was performed during this inspection.

## Supplied documentation reviewed

The owner supplied Sola's Introduction, iFields guide and Transaction API overview. It identifies the current detailed guides as https://docs.solapayments.com/products/ifields and https://docs.solapayments.com/api/transaction. Attempts to fetch those guides, including Markdown versions, still returned outbound proxy 403 errors. The supplied iFields guide documents hosted fields, setAccount and getTokens; the Transaction API overview documents gatewayjson and points to command-specific child pages. The credit-card command details and 3DS server guide are still needed before transaction processing is implemented.

The supplied text establishes the intended flow: iFields returns a single-use token (SUT); a server-side Transaction API request processes it; `xResult` identifies approval/decline/error, `xAuthAmount` must be compared to the requested amount, and `xRefnum` identifies a provider transaction. Reusable `xToken` values are distinct from SUTs. No implementation should substitute SUTs for reusable card-on-file tokens or store CVV. The text also describes sandbox-only test numbers and failure/timeout triggers; they must never be used with the saved live credentials.

Do not adopt the introduction's recommendation to log full request bodies and headers: those may include the API key or payment tokens. Use explicitly allowlisted, non-sensitive diagnostic fields. Do not automatically set `xAllowDuplicate=true`, change invoices after uncertain responses, or blindly retry a timeout; a delayed transaction may already have been approved. The document's `cc:save` and recurring capabilities do not authorize live payment-method writes or recurring schedules.

The iFields and general Transaction API documentation are now available. Remaining requirements for a payment adapter are the credit-card command details, any required 3DS server workflow, and separate sandbox credentials entered only into appropriate secure non-production settings. No provider API operations or card-entry initialization were performed during this review.

## Implemented sandbox setup check

`/settings/sola` never reads the live API key or the live iFields key. Production always renders setup instructions without loading any provider iframe or script. Enabling secure fields requires a separate Vercel Preview (or local development), a configured non-production Supabase project, an authenticated owner/admin of `SOLA_SANDBOX_ORGANIZATION_ID`, `SOLA_SANDBOX_ENABLED=true`, and a separate `SOLA_SANDBOX_IFIELDS_KEY`. The key must actually belong to a sandbox account; the code cannot infer key type from its text. Never put a live key in that slot. Other users cannot receive the sandbox key or fields.

The hosted SDK/iframe path is pinned to 2.15.2309.2601, the version referenced in the official @cardknox/react-ifields 2.2.86 README inspected from npm. It is not represented as the latest version. The React wrapper itself is not installed because its declared React 18 dependency conflicts with this app's React 19 runtime; the documented vanilla SDK interface is used. Confirm supported SDK version with Sola before live rollout.

The check calls setAccount for the separate sandbox key and requests separate card/CVV SUTs only when the signed-in administrator presses the check button. It immediately clears both hidden token values, returns only a success state, does not log tokens, and never sends them to an app endpoint or stores them. There is no payment-submit endpoint. Raw card number/CVV stay in the provider iframes. The check does not establish successful payments, merchant permissions, matching live API/iFields keys, 3DS behavior or production readiness.

Automated checks use synthetic token values and verify the production lock and nonce clearing; browser checks verify signed-out requests load no Sola script/iframe. Real provider tokenization remains untested until the separate sandbox/database setup is available.
