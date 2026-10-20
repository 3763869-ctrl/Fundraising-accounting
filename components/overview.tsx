"use client";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CircleAlert,
  Clock3,
  HeartHandshake,
  Wallet,
  CalendarClock,
  TrendingUp,
} from "lucide-react";
import {
  balance,
  sum,
  paid,
  scheduled,
  today,
  currency,
  type WorkspaceData,
  type Row,
} from "@/lib/workspace/domain";

export function Overview({
  data,
  navigate,
}: {
  data: WorkspaceData;
  navigate: (page: string) => void;
}) {
  const [range, setRange] = useState("90"),
    [group, setGroup] = useState("month"),
    [chart, setChart] = useState("bar");
  const t = data.tables,
    cutoff = new Date(`${today()}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - Number(range));
  const start = range === "all" ? "0000" : cutoff.toISOString().slice(0, 10);
  const pledges = t.pledges.filter(
      (p) => !p.voided_at && String(p.pledged_on) >= start,
    ),
    payments = t.payments.filter(
      (p) => p.status === "processed" && String(p.paid_on) >= start,
    );
  const pledged = sum(pledges, "amount_minor"),
    received = sum(payments, "amount_minor"),
    open = t.pledges.reduce((n, p) => n + balance(data, p), 0),
    onPlans = t.pledges.reduce((n, p) => n + scheduled(data, p.id), 0);
  const buckets = useMemo(() => {
    const result = new Map<
      string,
      { label: string; pledged: number; paid: number }
    >();
    const add = (r: Row, isPayment: boolean) => {
      const date = String(r[isPayment ? "paid_on" : "pledged_on"]);
      const key =
        group === "day"
          ? date
          : group === "week"
            ? (() => {
                const d = new Date(`${date}T12:00:00Z`);
                d.setUTCDate(d.getUTCDate() - d.getUTCDay());
                return d.toISOString().slice(0, 10);
              })()
            : date.slice(0, 7);
      if (!result.has(key))
        result.set(key, { label: key, pledged: 0, paid: 0 });
      result.get(key)![isPayment ? "paid" : "pledged"] += Number(
        r.amount_minor,
      );
    };
    pledges.forEach((r) => add(r, false));
    payments.forEach((r) => add(r, true));
    return [...result.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, r]) => r);
  }, [pledges, payments, group]);
  const max = Math.max(1, ...buckets.flatMap((b) => [b.pledged, b.paid]));
  const alerts = [
    {
      label: "Failed payments",
      count: t.payments.filter((p) => p.status === "failed").length,
      page: "payments",
      icon: CircleAlert,
      color: "red",
    },
    {
      label: "Pending payments",
      count: t.payments.filter((p) => p.status === "pending").length,
      page: "payments",
      icon: Clock3,
      color: "amber",
    },
    {
      label: "Overdue tasks",
      count: t.tasks.filter(
        (r) => r.status === "open" && String(r.due_date) < today(),
      ).length,
      page: "tasks",
      icon: CalendarClock,
      color: "purple",
    },
  ];
  const metrics = [
    {
      label: "Pledged in period",
      amount: pledged,
      note: `${pledges.length} commitments`,
      icon: HeartHandshake,
    },
    {
      label: "Received in period",
      amount: received,
      note: `${payments.length} processed payments`,
      icon: Wallet,
    },
    {
      label: "Open pledges",
      amount: open,
      note: "All dates · includes scheduled",
      icon: TrendingUp,
    },
    {
      label: "On payment plans",
      amount: onPlans,
      note: "All dates · active and paused",
      icon: CalendarClock,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your community, moving forward</p>
          <h1>Dashboard</h1>
          <p>See the impact. Stay close to every commitment.</p>
        </div>
        <select
          aria-label="Dashboard date range"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
          <option value="all">All dates</option>
        </select>
      </div>
      <div className="metric-grid">
        {metrics.map((m, i) => (
          <section className={`metric-card metric-${i}`} key={m.label}>
            <div className="row">
              <span>{m.label}</span>
              <m.icon size={19} />
            </div>
            <strong>{currency(m.amount)}</strong>
            <small>{m.note}</small>
          </section>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Giving at a glance</h2>
              <p>Pledges and received payments in the selected period</p>
            </div>
            <div className="row">
              <select
                aria-label="Chart grouping"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="month">Monthly</option>
                <option value="week">Weekly</option>
                <option value="day">Daily</option>
              </select>
              <select
                aria-label="Chart type"
                value={chart}
                onChange={(e) => setChart(e.target.value)}
              >
                <option value="bar">Bars</option>
                <option value="line">Lines</option>
              </select>
            </div>
          </div>
          <div className="legend">
            <span>
              <i className="legend-pledged" />
              Pledged
            </span>
            <span>
              <i className="legend-paid" />
              Received
            </span>
          </div>
          {!buckets.length ? (
            <div className="empty-state">
              <p>No giving activity in this period.</p>
            </div>
          ) : (
            <div className="chart-container">
              <svg
                viewBox="0 0 700 250"
                role="img"
                aria-label="Pledges versus received payments"
              >
                <title>Pledges and received payments by {group}</title>
                {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                  <g key={f}>
                    <line
                      x1="70"
                      x2="690"
                      y1={210 - f * 170}
                      y2={210 - f * 170}
                      stroke="#e7ece7"
                      strokeDasharray="3 4"
                    />
                    <text
                      x="60"
                      y={214 - f * 170}
                      textAnchor="end"
                      fill="#829086"
                      fontSize="10"
                    >
                      {currency(max * f).replace(".00", "")}
                    </text>
                  </g>
                ))}
                {chart === "line" ? (
                  <>
                    {["pledged", "paid"].map((series, index) => (
                      <polyline
                        key={series}
                        fill="none"
                        stroke={index ? "#b5a05b" : "#367463"}
                        strokeWidth="3"
                        points={buckets
                          .map(
                            (b, i) =>
                              `${85 + i * (590 / Math.max(buckets.length - 1, 1))},${210 - (Number(b[series as "paid" | "pledged"]) / max) * 170}`,
                          )
                          .join(" ")}
                      />
                    ))}
                  </>
                ) : (
                  buckets.map((b, i) => {
                    const width = 590 / buckets.length,
                      x = 80 + i * width;
                    return (
                      <g key={b.label}>
                        <rect
                          x={x}
                          y={210 - (b.pledged / max) * 170}
                          width={Math.max(2, width * 0.3)}
                          height={(b.pledged / max) * 170}
                          rx="3"
                          fill="#367463"
                        >
                          <title>
                            {b.label} · Pledged {currency(b.pledged)}
                          </title>
                        </rect>
                        <rect
                          x={x + width * 0.34}
                          y={210 - (b.paid / max) * 170}
                          width={Math.max(2, width * 0.3)}
                          height={(b.paid / max) * 170}
                          rx="3"
                          fill="#b5a05b"
                        >
                          <title>
                            {b.label} · Received {currency(b.paid)}
                          </title>
                        </rect>
                      </g>
                    );
                  })
                )}
                {buckets.map((b, i) =>
                  i % Math.max(1, Math.ceil(buckets.length / 6)) === 0 ? (
                    <text
                      key={b.label}
                      x={
                        85 +
                        i *
                          (590 /
                            (chart === "line"
                              ? Math.max(buckets.length - 1, 1)
                              : buckets.length))
                      }
                      y="237"
                      fill="#829086"
                      fontSize="10"
                    >
                      {b.label}
                    </text>
                  ) : null,
                )}
              </svg>
            </div>
          )}
          <details className="chart-data">
            <summary>View chart data</summary>
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Pledged</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{currency(b.pledged)}</td>
                    <td>{currency(b.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
        <section className="panel attention-panel">
          <p className="eyebrow">Keep things moving</p>
          <h2>Needs your attention</h2>
          {alerts.map((a) => (
            <button
              className="attention-row"
              key={a.label}
              onClick={() => navigate(a.page)}
            >
              <span className={`attention-icon ${a.color}`}>
                <a.icon size={19} />
              </span>
              <span>{a.label}</span>
              <strong>{a.count}</strong>
              <ArrowUpRight size={16} />
            </button>
          ))}
          <div className="attention-note">
            <span className="live-dot" />
            Recorded activity only
            <br />
            <small>Gateway processing is not connected.</small>
          </div>
        </section>
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Open pledges by fund</h2>
            <button className="text-button" onClick={() => navigate("funds")}>
              View funds <ArrowUpRight size={15} />
            </button>
          </div>
          {t.funds.length ? (
            t.funds.map((f) => {
              const campaigns = t.campaigns
                  .filter((c) => c.fund_id === f.id)
                  .map((c) => c.id),
                value = t.pledges
                  .filter((p) => campaigns.includes(String(p.campaign_id)))
                  .reduce((n, p) => n + balance(data, p), 0);
              return (
                <div className="fund-row" key={f.id}>
                  <div className="row">
                    <span>{String(f.name)}</span>
                    <strong>{currency(value)}</strong>
                  </div>
                  <div className="progress-track">
                    <div
                      style={{ width: `${open ? (value / open) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="muted">
              Add funds and assign campaigns to see balances here.
            </p>
          )}
          <small>Unassigned campaigns are excluded from this breakdown.</small>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Giving by fundraiser</h2>
            <button
              className="text-button"
              onClick={() => navigate("fundraisers")}
            >
              View all <ArrowUpRight size={15} />
            </button>
          </div>
          {t.fundraisers.map((f, i) => {
            const ps = pledges.filter((p) => p.fundraiser_id === f.id);
            return (
              <div className="fundraiser-row" key={f.id}>
                <span className={`avatar avatar-${i % 3}`}>
                  {String(f.name)
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <strong>{String(f.name)}</strong>
                  <small>{ps.length} pledges in period</small>
                </div>
                <b>{currency(sum(ps, "amount_minor"))}</b>
              </div>
            );
          })}
          {!t.fundraisers.length && (
            <p className="muted">
              Add your fundraising team to see their progress.
            </p>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent commitments</h2>
            <p>The people behind your next chapter.</p>
          </div>
          <button className="text-button" onClick={() => navigate("pledges")}>
            View pledges <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Donor</th>
                <th>Campaign</th>
                <th>Pledged</th>
                <th>Paid</th>
                <th>Open balance</th>
              </tr>
            </thead>
            <tbody>
              {[...t.pledges]
                .sort((a, b) =>
                  String(b.pledged_on).localeCompare(String(a.pledged_on)),
                )
                .slice(0, 5)
                .map((p) => (
                  <tr key={p.id}>
                    <td className="primary-cell">
                      <bdi>
                        {String(
                          t.donors.find((d) => d.id === p.donor_id)?.name,
                        )}
                      </bdi>
                    </td>
                    <td>
                      {String(
                        t.campaigns.find((c) => c.id === p.campaign_id)?.name,
                      )}
                    </td>
                    <td>{currency(p.amount_minor)}</td>
                    <td>{currency(paid(data, p.id))}</td>
                    <td>{currency(balance(data, p))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
