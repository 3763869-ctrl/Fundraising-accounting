"use client";
import {
  balance,
  paid,
  scheduled,
  currency,
  type Row,
  type WorkspaceData,
} from "@/lib/workspace/domain";
export function PledgeInvoice({
  data,
  row,
  demo,
}: {
  data: WorkspaceData;
  row: Row;
  demo: boolean;
}) {
  const donor = data.tables.donors.find((d) => d.id === row.donor_id);
  return (
    <>
      <div className="receipt-actions">
        <button onClick={() => window.print()}>Print / Save PDF</button>
        <small>
          No email has been sent. This is a pledge statement, not a payment
          receipt.
        </small>
      </div>
      <article
        className="receipt-document"
        dir={donor?.receipt_language === "he" ? "rtl" : "ltr"}
      >
        <div className="receipt-brand">Fundora</div>
        {demo && <p>SAMPLE DOCUMENT</p>}
        <h1>{String(data.organization.name)}</h1>
        <h2>Pledge statement</h2>
        <p>ID {row.id}</p>
        <p>
          <bdi>{String(donor?.name)}</bdi>
        </p>
        <p>
          Date: {String(row.pledged_on)} · Due: {String(row.due_date)}
        </p>
        <p>
          {String(
            data.tables.campaigns.find((c) => c.id === row.campaign_id)?.name,
          )}
        </p>
        <p className="preserve-lines">{String(row.description ?? "")}</p>
        <hr />
        <p>Pledged: {currency(row.amount_minor)}</p>
        <p>Paid: {currency(paid(data, row.id))}</p>
        <p>On plan: {currency(scheduled(data, row.id))}</p>
        <p>Open balance: {currency(balance(data, row))}</p>
        {Boolean(row.voided_at) && <strong>VOID</strong>}
      </article>
    </>
  );
}
