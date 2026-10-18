import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPastSales, utcToday } from "../api/sales";
import SalesTable from "../components/SalesTable";
import { Button, PageFrame } from "../components/ui";

/** Rows per page in the history pager. */
const PAGE_SIZE = 20;

const DATE_INPUT = "border border-ink/20 bg-paper px-2 py-1 text-sm text-ink";

/**
 * Read-only past-sales ledger (everything before today's UTC date).
 * No Mark paid, no Mark unpaid, no Void/Unvoid, no line editing — the
 * table is sortable but never alterable.
 *
 * The fetched rows are filtered on the client by an inclusive From/To date
 * range and paged locally; changing either date snaps back to page 1.
 */
export default function HistoryPage() {
  const today = utcToday();
  const historyQuery = useQuery({
    queryKey: ["sales", "history", today],
    queryFn: () => fetchPastSales(today),
  });

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const rows = historyQuery.data ?? [];

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const date = row.created_at.slice(0, 10);
        return (from === "" || date >= from) && (to === "" || date <= to);
      }),
    [rows, from, to],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const lastIndex = Math.min(firstIndex + PAGE_SIZE, filtered.length);
  const visible = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);

  function changeFrom(value: string) {
    setFrom(value);
    setPage(1);
  }

  function changeTo(value: string) {
    setTo(value);
    setPage(1);
  }

  function clearFilters() {
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="text-4xl font-semibold">History</h1>
          <p className="text-sm text-muted">
            Past sales ledger — read-only, sortable, never alterable.
          </p>
        </header>
        {historyQuery.isLoading ? (
          <p className="text-muted" aria-busy="true">
            Loading past sales…
          </p>
        ) : historyQuery.isError ? (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="text-lg">
              Could not load past sales.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void historyQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted">No past sales.</p>
        ) : (
          <div className="flex flex-col gap-6">
            <div
              role="group"
              aria-label="Filter past sales"
              className="flex flex-wrap items-end gap-3"
            >
              <label className="flex flex-col gap-1 text-xs text-muted">
                From
                <input
                  type="date"
                  aria-label="From date"
                  value={from}
                  onChange={(event) => changeFrom(event.target.value)}
                  className={DATE_INPUT}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={to}
                  onChange={(event) => changeTo(event.target.value)}
                  className={DATE_INPUT}
                />
              </label>
              <Button onClick={clearFilters}>Clear</Button>
            </div>
            {filtered.length === 0 ? (
              <p className="text-muted">No sales in this date range.</p>
            ) : (
              <>
                <SalesTable rows={visible} label="Past sales" />
                <footer className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    Showing {firstIndex + 1}–{lastIndex} of {filtered.length}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => setPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      Previous
                    </Button>
                    <Button
                      onClick={() => setPage(currentPage + 1)}
                      disabled={currentPage >= pageCount}
                    >
                      Next
                    </Button>
                  </div>
                </footer>
              </>
            )}
          </div>
        )}
      </PageFrame>
    </main>
  );
}
