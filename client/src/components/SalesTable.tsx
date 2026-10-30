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

/**
 * Compare two sales for a sort column/direction. Equal primaries fall back to
 * the newest id first so a stable, newest-first order always wins ties.
 */
export function compareSaleRows(
  key: SalesSortKey,
  dir: 1 | -1,
  a: SaleRow,
  b: SaleRow,
): number {
  const primary = dir * compareRows(key, a, b);
  return primary !== 0 ? primary : b.id - a.id;
}

/** Non-mutating sort over a copy of the rows. */
export function sortSaleRows(
  rows: SaleRow[],
  key: SalesSortKey,
  dir: 1 | -1,
): SaleRow[] {
  return [...rows].sort((a, b) => compareSaleRows(key, dir, a, b));
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
  sortKey: sortKeyProp,
  sortDir: sortDirProp,
  onSort,
  emptyMessage = "No sales.",
}: {
  rows: SaleRow[];
  renderActions?: (row: SaleRow) => ReactNode;
  /** Extra note appended to the Sale # cell (e.g. the holding order label). */
  rowNote?: (row: SaleRow) => string | null;
  /** Opens the row's receipt. The Sale # cell also becomes a real button. */
  onRowClick?: (row: SaleRow) => void;
  label?: string;
  /**
   * Controlled sort state. When `onSort` is supplied the parent owns the
   * ordering (History); otherwise the table keeps today's internal default.
   */
  sortKey?: SalesSortKey | null;
  sortDir?: 1 | -1;
  onSort?: (key: SalesSortKey) => void;
  /** Shown in an empty body row instead of nothing (e.g. per-method note). */
  emptyMessage?: string;
}) {
  const [internalKey, setInternalKey] = useState<SalesSortKey | null>(null);
  const [internalDir, setInternalDir] = useState<1 | -1>(1);
  const controlled = onSort !== undefined;
  const activeKey = controlled ? sortKeyProp ?? null : internalKey;
  const activeDir = controlled ? sortDirProp ?? 1 : internalDir;

  function toggle(key: SalesSortKey) {
    if (controlled) {
      onSort(key);
      return;
    }
    if (internalKey !== key) {
      setInternalKey(key);
      setInternalDir(-1);
    } else {
      setInternalDir((dir) => (dir === -1 ? 1 : -1));
    }
  }

  const sorted = useMemo(() => {
    if (activeKey === null) return rows;
    return sortSaleRows(rows, activeKey, activeDir);
  }, [rows, activeKey, activeDir]);

  function ariaSort(key: SalesSortKey): "ascending" | "descending" | "none" {
    if (activeKey !== key) return "none";
    return activeDir === 1 ? "ascending" : "descending";
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
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={renderActions ? 7 : 6}
              className="py-6 text-center text-muted"
            >
              {emptyMessage}
            </td>
          </tr>
        ) : (
          sorted.map((row) => (
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
          ))
        )}
      </tbody>
    </table>
  );
}
