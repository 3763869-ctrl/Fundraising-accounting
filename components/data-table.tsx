"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Download,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  X,
} from "lucide-react";

import { Modal } from "./record-form";

export type Column = { key: string; label: string; defaultHidden?: boolean };
export type TableRow = {
  id: string;
  values: Record<string, string | number>;
  status?: string;
};
export async function exportRows(
  columns: Column[],
  rows: TableRow[],
  name: string,
) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: 24,
  }));
  rows.forEach((r) => {
    const isMoney = (value: unknown) =>
      typeof value === "string" && /^-?\$[\d,]+\.\d{2}$/.test(value);
    const line = sheet.addRow(
      Object.fromEntries(
        columns.map((c) => {
          const value = r.values[c.key] ?? "";
          return [
            c.key,
            isMoney(value) ? Number(String(value).replace(/[$,]/g, "")) : value,
          ];
        }),
      ),
    );
    columns.forEach((c, index) => {
      if (isMoney(r.values[c.key]))
        line.getCell(index + 1).numFmt = "$#,##0.00;-$#,##0.00";
    });
  });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF193D35" },
  };
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `${name}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type View = { name: string; search: string; filter: string; visible: string[] };
export function DataTable({
  columns,
  rows,
  name,
  onOpen,
  action,
  storageKey,
  rowActions,
}: {
  columns: Column[];
  rows: TableRow[];
  name: string;
  onOpen?: (id: string) => void;
  action?: React.ReactNode;
  storageKey: string;
  rowActions?: (id: string) => React.ReactNode;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [visible, setVisible] = useState(
      columns.filter((c) => !c.defaultHidden).map((c) => c.key),
    ),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [views, setViews] = useState<View[]>([]),
    [viewName, setViewName] = useState(""),
    [error, setError] = useState(""),
    [sort, setSort] = useState({ key: columns[0]?.key ?? "", direction: 1 });
  const [editingColumns, setEditingColumns] = useState(false);
  const [draftColumns, setDraftColumns] = useState<string[]>([]);
  const [columnSearch, setColumnSearch] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved)) setViews(saved);
      const order = JSON.parse(
        localStorage.getItem(`${storageKey}-columns`) ?? "null",
      );
      if (Array.isArray(order)) {
        const valid = [
          ...new Set(
            order.filter(
              (key): key is string =>
                typeof key === "string" && columns.some((c) => c.key === key),
            ),
          ),
        ];
        if (valid.length) setVisible(valid);
      }
    } catch {
      /* Optional local view storage. */
    }
  }, [storageKey]);
  const statuses = [
    ...new Set(rows.map((r) => r.status).filter(Boolean)),
  ] as string[];
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (filter === "all" || r.status === filter) &&
            Object.values(r.values).some((v) =>
              String(v)
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
            ),
        )
        .sort((a, b) => {
          const av = a.values[sort.key],
            bv = b.values[sort.key];
          const money = (v: unknown) =>
            /^\$[\d,]+\.\d{2}$/.test(String(v))
              ? Number(String(v).replace(/[$,]/g, ""))
              : null;
          const am = money(av),
            bm = money(bv);
          return (
            (typeof av === "number" && typeof bv === "number"
              ? av - bv
              : am !== null && bm !== null
                ? am - bm
                : String(av ?? "").localeCompare(String(bv ?? ""))) *
            sort.direction
          );
        }),
    [rows, filter, search, sort],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / size)),
    current = Math.min(page, pages),
    chunk = filtered.slice((current - 1) * size, current * size),
    display = visible
      .map((key) => columns.find((c) => c.key === key))
      .filter((c): c is Column => Boolean(c));
  const selection = rows.filter((r) => selected.includes(r.id));
  const save = () => {
    if (!viewName.trim()) return;
    const next = [
      ...views.filter((v) => v.name !== viewName.trim()),
      { name: viewName.trim(), search, filter, visible },
    ];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setViews(next);
      setViewName("");
    } catch {
      setError("Saved views need browser storage.");
    }
  };
  return (
    <section className="data-panel">
      <div className="table-tools">
        <div className="searchbox">
          <Search size={16} />
          <input
            aria-label={`Search ${name}`}
            placeholder={`Search ${name.toLowerCase()}…`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="table-tools-right">
          {statuses.length > 0 && (
            <select
              aria-label="Filter status"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          <button
            className="icon-button"
            onClick={() => {
              setDraftColumns(visible);
              setColumnSearch("");
              setEditingColumns(true);
            }}
          >
            <SlidersHorizontal size={16} /> Columns
          </button>
          <details className="popover">
            <summary className="icon-button">
              <Bookmark size={16} />
              Views
            </summary>
            <div className="popover-body">
              <label>
                View name
                <input
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  maxLength={60}
                />
              </label>
              <button className="small-button" onClick={save}>
                Save current view
              </button>
              {views.map((v) => (
                <div className="row" key={v.name}>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSearch(v.search);
                      setFilter(v.filter);
                      setVisible(v.visible);
                      setPage(1);
                    }}
                  >
                    {v.name}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete view ${v.name}`}
                    onClick={() => {
                      const next = views.filter((x) => x.name !== v.name);
                      try {
                        localStorage.setItem(storageKey, JSON.stringify(next));
                        setViews(next);
                      } catch {
                        setError("Unable to update saved views.");
                      }
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <small>Saved in this browser for this organization.</small>
            </div>
          </details>
          <button
            className="icon-button"
            onClick={() =>
              exportRows(
                display,
                selection.length ? selection : filtered,
                name,
              ).catch(() => setError("Export failed. Please retry."))
            }
          >
            <Download size={16} />
            Excel
          </button>
          {action}
        </div>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {selection.length > 0 && (
        <div className="selection-bar">
          {selection.length} selected{" "}
          <button className="text-button" onClick={() => setSelected([])}>
            Clear selection
          </button>
          <span>Excel exports selected records.</span>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input
                  aria-label="Select this page"
                  type="checkbox"
                  checked={
                    chunk.length > 0 &&
                    chunk.every((r) => selected.includes(r.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...new Set([...selected, ...chunk.map((r) => r.id)])]
                        : selected.filter(
                            (id) => !chunk.some((r) => r.id === id),
                          ),
                    )
                  }
                />
              </th>
              {display.map((c) => (
                <th
                  key={c.key}
                  aria-sort={
                    sort.key === c.key
                      ? sort.direction === 1
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    onClick={() =>
                      setSort({
                        key: c.key,
                        direction: sort.key === c.key ? -sort.direction : 1,
                      })
                    }
                  >
                    {c.label}
                    {sort.key === c.key
                      ? sort.direction === 1
                        ? " ↑"
                        : " ↓"
                      : ""}
                  </button>
                </th>
              ))}
              {onOpen && <th>Details</th>}
              {rowActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {chunk.map((r) => (
              <tr key={r.id}>
                <td className="checkbox-cell">
                  <input
                    aria-label={`Select ${r.values[columns[0]?.key]}`}
                    type="checkbox"
                    checked={selected.includes(r.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, r.id]
                          : selected.filter((x) => x !== r.id),
                      )
                    }
                  />
                </td>
                {display.map((c, i) => (
                  <td key={c.key} className={i === 0 ? "primary-cell" : ""}>
                    {c.key === "status" ? (
                      <span
                        className={`status status-${String(r.values[c.key]).toLowerCase().replaceAll(" ", "-")}`}
                      >
                        {r.values[c.key]}
                      </span>
                    ) : i === 0 && onOpen ? (
                      <button
                        className="text-button"
                        onClick={() => onOpen(r.id)}
                      >
                        <bdi>{r.values[c.key] ?? "—"}</bdi>
                      </button>
                    ) : (
                      <bdi>{r.values[c.key] ?? "—"}</bdi>
                    )}
                  </td>
                ))}
                {onOpen && (
                  <td>
                    <button
                      className="text-button"
                      onClick={() => onOpen(r.id)}
                    >
                      View →
                    </button>
                  </td>
                )}
                {rowActions && <td>{rowActions(r.id)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!chunk.length && (
          <div className="empty-state">
            <Search size={28} />
            <h3>No {name.toLowerCase()} found</h3>
            <p>Try another search or add your first record.</p>
          </div>
        )}
      </div>
      {editingColumns && (
        <Modal title="Edit Columns" onClose={() => setEditingColumns(false)}>
          <div className="column-editor">
            <section>
              <input
                aria-label="Search columns"
                placeholder="Search columns"
                value={columnSearch}
                onChange={(e) => setColumnSearch(e.target.value)}
              />
              <h3>All results ({columns.length} Columns)</h3>
              <div className="column-list">
                {columns
                  .filter((c) =>
                    c.label.toLowerCase().includes(columnSearch.toLowerCase()),
                  )
                  .map((c) => (
                    <label className="check-label" key={c.key}>
                      <input
                        type="checkbox"
                        checked={draftColumns.includes(c.key)}
                        onChange={(e) =>
                          setDraftColumns(
                            e.target.checked
                              ? [...draftColumns, c.key]
                              : draftColumns.filter((key) => key !== c.key),
                          )
                        }
                      />
                      {c.label}
                    </label>
                  ))}
              </div>
            </section>
            <section>
              <h3>Selected Columns ({draftColumns.length})</h3>
              <div className="column-list">
                {draftColumns.map((key, index) => (
                  <div
                    className="column-order-row"
                    key={key}
                    draggable
                    onDragStart={() => setDragged(key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!dragged || dragged === key) return;
                      const next = draftColumns.filter((k) => k !== dragged);
                      next.splice(next.indexOf(key), 0, dragged);
                      setDraftColumns(next);
                      setDragged(null);
                    }}
                  >
                    <span>⠿ {columns.find((c) => c.key === key)?.label}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${columns.find((c) => c.key === key)?.label} up`}
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...draftColumns];
                        [next[index - 1], next[index]] = [
                          next[index],
                          next[index - 1],
                        ];
                        setDraftColumns(next);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${columns.find((c) => c.key === key)?.label} down`}
                      disabled={index === draftColumns.length - 1}
                      onClick={() => {
                        const next = [...draftColumns];
                        [next[index + 1], next[index]] = [
                          next[index],
                          next[index + 1],
                        ];
                        setDraftColumns(next);
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${columns.find((c) => c.key === key)?.label} column`}
                      onClick={() =>
                        setDraftColumns(draftColumns.filter((k) => k !== key))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <div className="form-footer">
            <button
              className="secondary"
              onClick={() => setEditingColumns(false)}
            >
              Cancel
            </button>
            <button
              disabled={!draftColumns.length}
              onClick={() => {
                setVisible(draftColumns);
                try {
                  localStorage.setItem(
                    `${storageKey}-columns`,
                    JSON.stringify(draftColumns),
                  );
                } catch {
                  setError("Column layout could not be saved in this browser.");
                }
                setEditingColumns(false);
              }}
            >
              Apply
            </button>
          </div>
        </Modal>
      )}
      <footer className="table-footer">
        <span>
          {filtered.length
            ? `${(current - 1) * size + 1}–${Math.min(current * size, filtered.length)}`
            : "0"}{" "}
          of {filtered.length} records
        </span>
        <div className="row">
          <label className="inline-label">
            Rows
            <select
              aria-label="Rows per page"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="Previous page"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current} / {pages}
          </span>
          <button
            className="icon-button"
            aria-label="Next page"
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
    </section>
  );
}
