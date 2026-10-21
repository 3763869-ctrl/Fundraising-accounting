import Link from "next/link";

const fundraising = [
  "Fundraising dashboard",
  "Donor CRM",
  "Campaign management",
  "Pledge tracking",
  "Payment schedules",
  "Recurring donations",
  "Pledge reminders",
  "Email & SMS receipts",
  "Advanced reports",
  "Open API",
];
const accounting = [
  "Income & expenses",
  "Vendors & payables",
  "Financial statements",
  "Campaign profit reports",
  "Chart of accounts",
  "Batch automations",
  "Fund accounting",
  "Account reconciliation",
  "Bank feeds",
  "Check printing",
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="mark">F</span>Fundora
        </Link>
        <Link className="button light" href="/login">
          Sign in
        </Link>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">Built around your mission · United States</p>
          <h1>
            Every commitment.
            <br />
            Every dollar.
            <br />
            One clear picture.
          </h1>
          <p>
            A shared home for donor relationships, fundraising, and your
            organization’s finances. Starting with the foundation, growing with
            your work.
          </p>
          <div className="actions">
            <Link className="button" href="/demo">
              Explore the sample workspace ↗
            </Link>
            <Link className="button light" href="/login?mode=signup">
              Set up your organization
            </Link>
            <span className="pill">USD · US organizations</span>
          </div>
        </div>
        <div className="card green">
          <p className="eyebrow">Phase 1 · Fundraising</p>
          <h2>Start with what matters.</h2>
          <p>
            Donors, campaigns, pledges, manual payments, allocations, credit,
            payment plans, printable acknowledgments, and reports.
          </p>
          <hr
            style={{
              border: 0,
              borderTop: "1px solid #bccdc1",
              margin: "24px 0",
            }}
          />
          <small>
            Payments and bank connections are planned. No card charges or bank
            transactions are processed in this release.
          </small>
        </div>
      </section>
      <div className="section-head">
        <h2>Your roadmap, in one place.</h2>
        <span className="pill">Planned capabilities</span>
      </div>
      <div className="feature-grid">
        <section className="card gold">
          <h2>Fundraising</h2>
          <ul>
            {fundraising.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
        <section className="card green">
          <h2>Accounting</h2>
          <ul>
            {accounting.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      </div>
      <footer className="footer">
        Foundation in development · Sola, charity-card, and Chase integrations
        pending.
      </footer>
    </main>
  );
}
