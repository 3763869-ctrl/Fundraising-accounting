# Pledges and payment entry

The pledges and payments pages share **+ New donation → New pledge / New payment**.

Pledges have permanent UUIDs. The default Open pledges view excludes paid and voided records; All pledges retains their history. Clicking the first table cell or View opens a detail card. Payment detail cards retain allocations and the receipt workflow.

Columns opens a searchable editor. Select columns and drag selected rows, or use the up/down buttons, then Apply. Cancel discards changes. Applied order and visibility persist in this browser for this organization. Saved views also retain column order. Excel exports use the displayed order. Source/import fields stay empty when the app has no corresponding source record.

New payment requires an existing donor, amount, and destination campaign. The payment date defaults to today. Fundraiser, sponsorship, event and donor-visible description are optional. Add a donor under Contacts before entering their donation.

Open pledges appear under the donor. Select amounts manually or auto-select: first prefer an exact available-balance match; otherwise allocate oldest pledge date first, with creation date and ID as tie breakers. Payment-plan reservations are not available for general allocation. Pending and failed payments cannot settle pledges. Excess received money remains donor credit. Leaving all open pledges unapplied requires explicit confirmation, enforced by the database as well as the UI.

This form records previously received payments; it never initiates a card charge. Cash, check, Zelle, bank transfer and other are manual methods. Credit card and charity card records require a reference. Charity-card integrations remain unconfigured. The live workspace links credit-card users to the separate secure Sola charge page. Sample mode never links to live card entry. Existing installment recording retains its exact-amount workflow.

Descriptions appear on pledge statements and newly issued payment acknowledgment snapshots. Existing receipt snapshots remain immutable after edits. Printing supports browser Save PDF. Email invoice and SMS/email reminder menu items are visibly disabled pending delivery integration.

Edits preserve donor identity. Payment amounts, dates, methods, gateway references and posted accounting records cannot be rewritten through this editor. Pledge amount, campaign and pledge date lock after allocations, active/paused plans or accounting recognition; due date and descriptive details remain editable. Voiding retains the original pledge and audit history, and is allowed only with no allocations, active/paused plans or accounting recognition. Voided pledges cannot accept allocations, new plans or recognition.

Migration `202610200013_donation_workspace.sql` adds metadata, RPCs, permission checks and active-pledge guards. It does not create sample records in the live database or submit provider transactions.
