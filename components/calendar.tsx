"use client";
import { useState } from "react";
import { HebrewCalendar, HDate } from "@hebcal/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { today, type WorkspaceData } from "@/lib/workspace/domain";

export function Calendar({ data }: { data: WorkspaceData }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [year, m] = month.split("-").map(Number),
    first = new Date(year, m - 1, 1),
    days = new Date(year, m, 0).getDate();
  const events = HebrewCalendar.calendar({
    start: new Date(year, m - 1, 1),
    end: new Date(year, m - 1, days),
    il: false,
    sedrot: true,
    noMinorFast: false,
  });
  const shift = (amount: number) => {
    const d = new Date(year, m - 1 + amount, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            {first.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <p>
            Gregorian and Hebrew dates · Diaspora holiday and parshah calendar
          </p>
        </div>
        <div className="row">
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="month"
            aria-label="Calendar month"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => shift(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Shabbat"].map((d) => (
          <div className="calendar-day-label" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: first.getDay() }, (_, i) => (
          <div className="calendar-blank" key={`blank-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = new Date(year, m - 1, i + 1),
            key = `${month}-${String(i + 1).padStart(2, "0")}`,
            hebrew = new HDate(date);
          const holidays = events.filter(
            (e) => e.getDate().greg().toDateString() === date.toDateString(),
          );
          const tasks = data.tables.tasks.filter((t) => t.due_date === key),
            community = data.tables.events.filter((e) => e.event_date === key),
            sponsorships = data.tables.pledges.filter(
              (p) =>
                p.sponsorship_id && (p.sponsorship_date ?? p.due_date) === key,
            );
          return (
            <div
              className={`calendar-cell ${key === today() ? "calendar-today" : ""}`}
              key={key}
            >
              <div className="row">
                <strong>{i + 1}</strong>
                <small>
                  {hebrew.getDate()} {hebrew.getMonthName()}
                </small>
              </div>
              {holidays.map((e, n) => (
                <span className="calendar-event holiday" key={n}>
                  {e.render("en")}
                </span>
              ))}
              {tasks.map((t) => (
                <span className="calendar-event" key={t.id}>
                  {String(t.subject)}
                </span>
              ))}
              {community.map((e) => (
                <span className="calendar-event community-event" key={e.id}>
                  {String(e.name)}
                </span>
              ))}
              {sponsorships.map((p) => (
                <span className="calendar-event community-event" key={p.id}>
                  {String(
                    data.tables.sponsorships.find(
                      (s) => s.id === p.sponsorship_id,
                    )?.name ?? "Sponsorship",
                  )}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <p className="report-note">
        Calendar dates are daytime civil dates. Holidays begin the preceding
        evening; candle-lighting times and location-specific observances are not
        included.
      </p>
    </section>
  );
}
