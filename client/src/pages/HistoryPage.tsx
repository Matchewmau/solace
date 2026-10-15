import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPastSales, utcToday } from "../api/sales";
import SalesTable from "../components/SalesTable";

/**
 * Read-only past-sales ledger (everything before today's UTC date).
 * No Mark paid, no Mark unpaid, no Void/Unvoid, no line editing — the
 * table is sortable but never alterable.
 */
export default function HistoryPage() {
  const today = utcToday();
  const historyQuery = useQuery({
    queryKey: ["sales", "history", today],
    queryFn: () => fetchPastSales(today),
  });

  const rows = historyQuery.data ?? [];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
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
          <SalesTable rows={rows} label="Past sales" />
        )}
        <div>
          <Link
            to="/pos"
            aria-label="Back to POS"
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            ← Back to POS
          </Link>
        </div>
      </div>
    </main>
  );
}
