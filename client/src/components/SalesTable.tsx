import { useMemo, useState, type ReactNode } from "react";
import { formatPeso } from "../lib/formatPeso";
import { Badge } from "./ui";
import {
  CELL_CARD,
  ROW_CARD,
  ROW_HOVER,
  ROW_HOVER_STRONG,
  SORT_HEADER,
} from "./tableStyles";
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

/** Voided wins over paid; a settled row is green, an open row is red. */
function statusBadge(row: SaleRow) {
  if (row.voided === 1) return <Badge tone="neutral">Voided</Badge>;
  if (row.paid === 1) return <Badge tone="ok">Paid</Badge>;
  return <Badge tone="danger">Unpaid</Badge>;
}

/**
 * Sortable sales table (semantic <table>, sort buttons with aria-sort).
 * First click on a column sorts descending (newest/largest first — the
 * useful direction for a sales ledger); a second click flips to ascending.
 * History renders it bare (read-only); Today passes row actions
 * (Void/Unvoid + Reopen) via `renderActions`. Below `md` each row becomes a
 * label+value card via the shared Task 4 row-card classes.
 */
export default function SalesTable({
  rows,
  renderActions,
  rowNote,
  onRowClick,
  label = "Sales",
}: {
  rows: SaleRow[];
  renderActions?: (row: SaleRow) => ReactNode;
  /** Extra note appended to the Sale # cell (e.g. the holding order label). */
  rowNote?: (row: SaleRow) => string | null;
  /** Opens the row's receipt. The Sale # cell also becomes a real button. */
  onRowClick?: (row: SaleRow) => void;
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

  return (
    <table
      aria-label={label}
      className="w-full border-collapse text-left text-base"
    >
      <thead className="max-md:hidden">
        <tr className="border-b border-ink/20">
          <th scope="col" aria-sort={ariaSort("id")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("id")}
              className={SORT_HEADER}
            >
              Sale #
            </button>
          </th>
          <th scope="col" aria-sort={ariaSort("date")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("date")}
              className={SORT_HEADER}
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
              className={SORT_HEADER}
            >
              Payment
            </button>
          </th>
          <th scope="col" aria-sort={ariaSort("total")} className="py-2 pr-4">
            <button
              type="button"
              onClick={() => toggle("total")}
              className={SORT_HEADER}
            >
              Total
            </button>
          </th>
          <th scope="col" className="py-2 pr-4">
            Status
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
          <tr
            key={row.id}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`border-b border-ink/10 ${ROW_CARD} ${
              onRowClick ? ROW_HOVER_STRONG : ROW_HOVER
            }${row.voided === 1 ? " text-muted" : ""}${
              onRowClick ? " cursor-pointer" : ""
            }`}
          >
            <td data-label="Sale #" className={`py-2 pr-4 font-semibold ${CELL_CARD}`}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={(event) => {
                    // The row itself is clickable; keep this click to one open.
                    event.stopPropagation();
                    onRowClick(row);
                  }}
                  className="text-left font-semibold underline decoration-dotted underline-offset-4 hover:text-accent"
                >
                  Sale #{row.id}
                  {rowNote?.(row) ? ` (${rowNote(row)})` : ""}
                </button>
              ) : (
                <>
                  Sale #{row.id}
                  {rowNote?.(row) ? ` (${rowNote(row)})` : ""}
                </>
              )}
            </td>
            <td data-label="Date" className={`py-2 pr-4 text-muted ${CELL_CARD}`}>
              {row.created_at.slice(0, 10)}
            </td>
            <td data-label="Time" className={`py-2 pr-4 text-muted ${CELL_CARD}`}>
              {row.created_at.slice(11, 16)}
            </td>
            <td data-label="Payment" className={`py-2 pr-4 ${CELL_CARD}`}>
              {row.payment === "cash" ? "Cash" : "GCash"}
            </td>
            <td data-label="Total" className={`py-2 pr-4 text-accent ${CELL_CARD}`}>
              {formatPeso(row.total_cents)}
            </td>
            <td data-label="Status" className={`py-2 pr-4 ${CELL_CARD}`}>
              {statusBadge(row)}
            </td>
            {renderActions ? (
              <td
                data-label="Actions"
                className={`py-2 ${CELL_CARD}`}
                onClick={(event) => event.stopPropagation()}
              >
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
