import { useMemo, useState, type ReactNode } from "react";
import { formatPeso } from "../lib/formatPeso";
import type { SaleRow } from "../api/sales";

export type SalesSortKey = "id" | "date" | "total" | "payment";

function compareRows(key: SalesSortKey, a: SaleRow, b: SaleRow): number {
  switch (key) {
    case "id":
      return a.id - b.id;
    case "date":
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
    case "total":
      return a.total_cents - b.total_cents;
    case "payment":
      return a.payment.localeCompare(b.payment);
  }
}

/**
 * Sortable sales table (semantic <table>, sort buttons with aria-sort).
 * First click on a column sorts descending (newest/largest first — the
 * useful direction for a sales ledger); a second click flips to ascending.
 * History renders it bare (read-only); Today passes row actions
 * (Void/Unvoid + Reopen) via `renderActions`.
 */
export default function SalesTable({
  rows,
  renderActions,
  rowNote,
  label = "Sales",
}: {
  rows: SaleRow[];
  renderActions?: (row: SaleRow) => ReactNode;
  /** Extra note appended to the Sale # cell (e.g. the holding order label). */
  rowNote?: (row: SaleRow) => string | null;
  label?: string;
}) {
  const [sortKey, setSortKey] = useState<SalesSortKey | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  function toggle(key: SalesSortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(-1);
    } else {
      setSortDir((dir) => (dir === -1 ? 1 : -1));
    }
  }

  const sorted = useMemo(() => {
    if (sortKey === null) return rows;
    return [...rows].sort((a, b) => sortDir * compareRows(sortKey, a, b));
  }, [rows, sortKey, sortDir]);

  function ariaSort(key: SalesSortKey): "ascending" | "descending" | "none" {
    if (sortKey !== key) return "none";
    return sortDir === 1 ? "ascending" : "descending";
  }

  const headerButton =
    "font-semibold underline decoration-dotted underline-offset-4";

  return (
    <table
      aria-label={label}
      className="w-full border-collapse text-left text-base"
    >
      <thead>
        <tr className="border-b border-ink/20">
          <th scope="col" aria-sort={ariaSort("id")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("id")}
              className={headerButton}
            >
              Sale #
            </button>
          </th>
          <th scope="col" aria-sort={ariaSort("date")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("date")}
              className={headerButton}
            >
              Date
            </button>
          </th>
          <th scope="col" className="py-2 pr-4">
            Time
          </th>
          <th scope="col" aria-sort={ariaSort("payment")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("payment")}
              className={headerButton}
            >
              Payment
            </button>
          </th>
          <th scope="col" aria-sort={ariaSort("total")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("total")}
              className={headerButton}
            >
              Total
            </button>
          </th>
          <th scope="col" className="py-2 pr-4">
            Voided
          </th>
          {renderActions ? (
            <th scope="col" className="py-2">
              Actions
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.id} className="border-b border-ink/10">
            <td className="py-2 pr-4 font-semibold">
              Sale #{row.id}
              {rowNote?.(row) ? ` (${rowNote(row)})` : ""}
            </td>
            <td className="py-2 pr-4 text-muted">{row.created_at.slice(0, 10)}</td>
            <td className="py-2 pr-4 text-muted">{row.created_at.slice(11, 16)}</td>
            <td className="py-2 pr-4">
              {row.payment === "cash" ? "Cash" : "GCash"}
            </td>
            <td className="py-2 pr-4 text-accent">
              {formatPeso(row.total_cents)}
            </td>
            <td className="py-2 pr-4">{row.voided === 1 ? "Voided" : "—"}</td>
            {renderActions ? (
              <td className="py-2">
                <span className="flex flex-wrap gap-2">
                  {renderActions(row)}
                </span>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
