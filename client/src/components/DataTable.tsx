import { useMemo, useState, type ReactNode } from "react";

export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  /** Sort accessor. A sortable column without one keeps the incoming order. */
  value?: (row: T) => string | number;
  render: (row: T) => ReactNode;
};

type SortState = { key: string; dir: "asc" | "desc" };

/**
 * Row-card classes: below `md` the same `<table>` markup restyles into
 * label+value cards (single DOM — no second card list). Reused verbatim by
 * SalesTable and every other table page.
 */
const ROW_CARD = "max-md:block max-md:flex max-md:justify-between";
const CELL_CARD = `${ROW_CARD} max-md:before:content-[attr(data-label)] max-md:text-muted`;

const headerButton =
  "font-semibold underline decoration-dotted underline-offset-4";

function compareRows<T>(column: Column<T>, a: T, b: T): number {
  if (column.value === undefined) return 0;
  const av = column.value(a);
  const bv = column.value(b);
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/**
 * Sortable, responsive table. Desktop renders a semantic `<table>`; below
 * `md` each row becomes a card via `max-md:` classes, each cell prefixed with
 * its column label from `data-label`.
 *
 * Clicking a sortable header sorts it descending first (largest/newest
 * first), then flips to ascending on the next click; `defaultSort` sets the
 * initial state. `aria-sort` mirrors the active column and direction.
 */
export default function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  renderActions,
  defaultSort,
  emptyMessage = "Nothing here yet.",
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  renderActions?: (row: T) => ReactNode;
  defaultSort?: SortState;
  emptyMessage?: string;
}) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);

  function toggle(key: string) {
    setSort((current) => {
      if (current === null || current.key !== key) return { key, dir: "desc" };
      return { key, dir: current.dir === "asc" ? "desc" : "asc" };
    });
  }

  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (column === undefined || column.value === undefined) return rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => sign * compareRows(column, a, b));
  }, [rows, columns, sort]);

  function ariaSort(key: string): "ascending" | "descending" | "none" {
    if (sort === null || sort.key !== key) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  }

  const columnCount = columns.length + (renderActions ? 1 : 0);

  return (
    <table
      aria-label={label}
      className="w-full border-collapse text-left text-base"
    >
      <thead className="max-md:hidden">
        <tr className="border-b border-ink/20">
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              aria-sort={column.sortable ? ariaSort(column.key) : undefined}
              className={`py-2 pr-4 ${
                column.align === "right" ? "text-right" : ""
              }`}
            >
              {column.sortable ? (
                <button
                  type="button"
                  onClick={() => toggle(column.key)}
                  className={headerButton}
                >
                  {column.label}
                </button>
              ) : (
                column.label
              )}
            </th>
          ))}
          {renderActions ? (
            <th scope="col" className="py-2">
              Actions
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr className={ROW_CARD}>
            <td
              colSpan={columnCount}
              className={`py-2 text-muted ${ROW_CARD}`}
            >
              {emptyMessage}
            </td>
          </tr>
        ) : (
          sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-b border-ink/10 ${ROW_CARD}`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.label}
                  className={`py-2 pr-4 ${
                    column.align === "right" ? "text-right" : ""
                  } ${CELL_CARD}`}
                >
                  {column.render(row)}
                </td>
              ))}
              {renderActions ? (
                <td data-label="Actions" className={`py-2 ${CELL_CARD}`}>
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
