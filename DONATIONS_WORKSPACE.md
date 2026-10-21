# Pledges and payment entry

The pledges and payments pages share **+ New donation → New pledge / New payment**.

Pledges have permanent UUIDs. The default Open pledges view excludes paid and voided records; All pledges retains their history. Clicking the first table cell or View opens a detail card. Payment detail cards retain allocations and the receipt workflow.

Columns opens a searchable editor. Select columns and drag selected rows, or use the up/down buttons, then Apply. Cancel discards changes. Applied order and visibility persist in this browser for this organization. Saved views also retain column order. Excel exports use the displayed order. Source/import fields stay empty when the app has no corresponding source record.

New payment requires an existing donor, amount, and destination campaign. The payment date defaults to today. Fundraiser, sponsorship, event and donor-visible description are optional. Add a donor under Contacts before entering their donation.

Open pledges appear under the donor. Select amounts manually or auto-select: first prefer an exact available-balance match; otherwise allocate oldest pledge date first, with creation date and ID as tie breakers. Payment-plan reservations are not available for general allocation. Pending and failed payments cannot settle pledges. Excess received money remains donor credit. Leaving all open pledges unapplied requires explicit confirmation, enforced by the database as well as the UI.

Choosing Credit card opens Sola-hosted card number and CVV fields inline in New payment. Enter expiration and optional ZIP, choose pledge allocations, and authorize one deliberate charge. The optional Save card checkbox starts unchecked. Previously saved cards can be selected without exposing provider tokens to the browser. Donor profiles include masked cards and Add card (a non-charging provider save). Other payment methods remain manual records. Matbia is prepared under Charity card, with sample simulations and live processing disabled pending provider activation; other charity cards remain manual. Sample mode never loads live hosted fields or sends provider calls. Existing manual installment recording retains its exact-amount workflow.

Descriptions appear on pledge statements and newly issued payment acknowledgment snapshots. Existing receipt snapshots remain immutable after edits. Printing supports browser Save PDF. Email invoice and SMS/email reminder menu items are visibly disabled pending delivery integration.

Edits preserve donor identity. Payment amounts, dates, methods, gateway references and posted accounting records cannot be rewritten through this editor. Pledge amount, campaign and pledge date lock after allocations, active/paused plans or accounting recognition; due date and descriptive details remain editable. Voiding retains the original pledge and audit history, and is allowed only with no allocations, active/paused plans or accounting recognition. Voided pledges cannot accept allocations, new plans or recognition.

Migration `202610200013_donation_workspace.sql` adds metadata, RPCs, permission checks and active-pledge guards. It does not create sample records in the live database or submit provider transactions.


Cash payments have Void cash payment in the row menu and detail card. A reason and correction date are required. Voids retain the payment, original receipt snapshots and archived allocations, mark receipts void, reopen linked pledges and installments, and post balanced reversing entries. They cannot refund cash or void a processor transaction. Already deposited cash retains its bank and reconciliation history; the amount moves to a cash suspense liability and creates a review task. Clear that suspense after examining the actual bank movement. Cash-basis reports retain the original income before the void date and show the reversal in the correction period.

Matbia setup, safety gates and isolated provider sandbox verification are documented in [MATBIA_SETUP.md](MATBIA_SETUP.md). Sample simulations clearly label themselves and never request a real card.
