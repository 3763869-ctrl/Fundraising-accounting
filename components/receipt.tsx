import { Printer } from "lucide-react";
import { currency, type Row } from "@/lib/workspace/domain";

export function Receipt({ receipt, demo }: { receipt: Row; demo: boolean }) {
  const s = receipt.snapshot as Record<string, unknown>,
    hebrew = receipt.language === "he";
  return (
    <>
      <div className="receipt-actions">
        <button onClick={() => window.print()}>
          <Printer size={16} />
          Print / Save PDF
        </button>
        <small>Document generated · no email has been sent</small>
      </div>
      <article className="receipt-document" dir={hebrew ? "rtl" : "ltr"}>
        <div className="receipt-brand">Cedar & Olive</div>
        {demo && (
          <div className="sample-watermark">SAMPLE — NOT A TAX RECEIPT</div>
        )}
        <h1>{String(s.organization)}</h1>
        {s.tax_id ? (
          <p>EIN: {String(s.tax_id)}</p>
        ) : (
          <p className="muted">Tax ID not configured</p>
        )}
        {Boolean(s.description) && (
          <p className="preserve-lines">{String(s.description)}</p>
        )}
        <hr />
        <h2>{hebrew ? "אישור קבלת תרומה" : "Payment acknowledgment"}</h2>
        <div className="row">
          <strong>RCPT-{String(receipt.number).padStart(6, "0")}</strong>
          <span>{String(s.paid_on)}</span>
        </div>
        <p>
          {hebrew ? "שם התורם" : "Donor"}:{" "}
          <bdi>{String(hebrew && s.hebrew_name ? s.hebrew_name : s.donor)}</bdi>
        </p>
        <div className="receipt-amount">{currency(s.amount_minor)}</div>
        <p>
          {hebrew ? "אמצעי תשלום" : "Payment method"}:{" "}
          {String(s.method).replaceAll("_", " ")}
        </p>
        {Boolean(s.reference) && (
          <p>
            {hebrew ? "אסמכתא" : "Reference"}: {String(s.reference)}
          </p>
        )}
        {Boolean(s.description) && (
          <p className="preserve-lines">{String(s.description)}</p>
        )}
        <hr />
        <p>
          {hebrew
            ? "תודה על תמיכתכם בקהילה שלנו."
            : "Thank you for supporting our community."}
        </p>
        {Boolean(s.template) && (
          <p className="preserve-lines">
            {String(s.template)
              .replaceAll("{{organization}}", String(s.organization))
              .replaceAll(
                "{{donor}}",
                String(hebrew && s.hebrew_name ? s.hebrew_name : s.donor),
              )
              .replaceAll("{{amount}}", currency(s.amount_minor))
              .replaceAll("{{date}}", String(s.paid_on))}
          </p>
        )}
        <small>
          This acknowledges a recorded payment. Tax deductibility and any goods
          or services received must be reviewed by the organization before
          issuing an official charitable contribution acknowledgment. No tax
          determination is made by this document.
        </small>
      </article>
    </>
  );
}
