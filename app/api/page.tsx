import Link from "next/link";
export default function ApiDocs() {
  return (
    <main className="shell">
      <Link className="brand" href="/">
        Cedar & Olive
      </Link>
      <section className="card">
        <p className="eyebrow">Authenticated API · v1</p>
        <h1>Your records, connected.</h1>
        <p>
          Requires a configured Supabase project and a valid signed-in user's
          access token. Every request uses that user's database permissions and
          organization isolation. No service-role key is accepted or required.
        </p>
        <h2>Read records</h2>
        <pre style={{ overflow: "auto" }}>
          GET /api/v1/donors?organization_id=UUID&amp;limit=50&amp;offset=0
          {"\n"}Authorization: Bearer YOUR_USER_ACCESS_TOKEN
        </pre>
        <p>
          Resources: donors, campaigns, pledges, payments, allocations,
          schedules, jobs. Page size: 1–100. Unauthorized organizations return
          no records. Job logs require administrator access.
        </p>
        <h2>Record an externally handled payment</h2>
        <pre style={{ overflow: "auto" }}>{`POST /api/v1/payments
Authorization: Bearer YOUR_USER_ACCESS_TOKEN
Content-Type: application/json

{
  "organization_id": "UUID",
  "donor_id": "UUID",
  "amount_minor": 18000,
  "paid_on": "2026-10-19",
  "method": "check",
  "status": "processed",
  "reference": "EXTERNAL-REFERENCE",
  "idempotency_key": "UNIQUE-REQUEST-UUID",
  "allocations": [{"pledge_id": "UUID", "amount_minor": 10000}]
}`}</pre>
        <p>
          This records a payment; it never charges a card. The remaining $80 is
          donor credit. Reuse the same idempotency key for a retry of the
          identical payload. Pending/failed payments cannot fulfill pledges.
          Unknown fields and raw card credentials are rejected.
        </p>
        <h2>Provider connections</h2>
        <p>
          Owner-operated Sola card entry is separate at /payments/card and uses
          a verified owner session, merchant binding and server-only
          credentials. This v1 manual-record API never charges a card.
          Charity-card, Chase, outbound messaging and provider webhook adapters
          remain pending.
        </p>
      </section>
    </main>
  );
}
