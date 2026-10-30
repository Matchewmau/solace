import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPastSales, utcToday, type SaleRow } from "../api/sales";
import { formatPeso } from "../lib/formatPeso";
import SaleDetailDialog from "../components/SaleDetailDialog";
import SalesTable, { sortSaleRows, type SalesSortKey } from "../components/SalesTable";
import { Button, EmptyState, PageFrame, StatChip } from "../components/ui";

/** Rows per page in the history pager. */
const PAGE_SIZE = 20;

/** Filter buttons in the payment-method switch. */
const PAYMENT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
] as const;

type PaymentOption = (typeof PAYMENT_OPTIONS)[number]["value"];

/** Live (non-voided) count and peso total for a set of rows. */
function liveCountTotal(rows: SaleRow[]): { count: number; total: number } {
  const live = rows.filter((row) => row.voided !== 1);
  return {
    count: live.length,
    total: live.reduce((sum, row) => sum + row.total_cents, 0),
  };
}

/**
 * Read-only past-sales ledger (everything before today's UTC date).
 * No Mark paid, no Mark unpaid, no Void/Unvoid, no line editing — the
 * table is sortable but never alterable.
 *
 * The fetched rows are filtered on the client by an inclusive From/To date
 * range and an All/Cash/GCash payment switch, then sorted newest-first
 * (created_at DESC, id DESC) over the full filtered ledger before paging;
 * changing a filter snaps back to page 1.
 */
export default function HistoryPage() {
  const today = utcToday();
  const historyQuery = useQuery({
    queryKey: ["sales", "history", today],
    queryFn: () => fetchPastSales(today),
  });

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [payment, setPayment] = useState<PaymentOption>("all");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SalesSortKey | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);

  const rows = historyQuery.data ?? [];

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const date = row.created_at.slice(0, 10);
        return (from === "" || date >= from) && (to === "" || date <= to);
      }),
    [rows, from, to],
  );

  // Rows of the selected payment method, sorted over the whole filtered
  // ledger (never just the visible page) and voided rows still listed.
  const paymentRows = useMemo(
    () =>
      filtered.filter(
        (row) => payment === "all" || row.payment === payment,
      ),
    [filtered, payment],
  );
  const sortedRows = useMemo(
    () =>
      sortKey === null
        ? sortSaleRows(paymentRows, "date", -1)
        : sortSaleRows(paymentRows, sortKey, sortDir),
    [paymentRows, sortKey, sortDir],
  );

  // Switch counts/totals and summary ignore voided rows per option.
  const optionCounts = useMemo(
    () => ({
      all: liveCountTotal(filtered),
      cash: liveCountTotal(
        filtered.filter((row) => row.payment === "cash"),
      ),
      gcash: liveCountTotal(
        filtered.filter((row) => row.payment === "gcash"),
      ),
    }),
    [filtered],
  );
  const paymentLive = useMemo(
    () => paymentRows.filter((row) => row.voided !== 1),
    [paymentRows],
  );

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const lastIndex = Math.min(firstIndex + PAGE_SIZE, sortedRows.length);
  const visible = sortedRows.slice(firstIndex, firstIndex + PAGE_SIZE);

  const revenueCents = paymentLive.reduce((sum, row) => sum + row.total_cents, 0);
  const paidCount = paymentLive.filter((row) => row.paid === 1).length;
  const unpaidCount = paymentLive.filter((row) => row.paid !== 1).length;
  const averageCents =
    paymentLive.length > 0
      ? Math.round(revenueCents / paymentLive.length)
      : 0;

  function changeFrom(value: string) {
    setFrom(value);
    setPage(1);
  }

  function changeTo(value: string) {
    setTo(value);
    setPage(1);
  }

  function changePayment(value: PaymentOption) {
    setPayment(value);
    setPage(1);
  }

  function handleSort(key: SalesSortKey) {
    if (sortKey !== key) {
      // A new key starts descending (newest/largest first).
      setSortKey(key);
      setSortDir(-1);
    } else {
      setSortDir((dir) => (dir === -1 ? 1 : -1));
    }
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
          <h1 className="page-title">History</h1>
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
            <Button
              variant="outline"
              onClick={() => {
                void historyQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState message="No past sales yet — settled days will appear here." />
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
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={to}
                  onChange={(event) => changeTo(event.target.value)}
                  className="field"
                />
              </label>
              <Button onClick={clearFilters}>Clear</Button>
            </div>
            {filtered.length === 0 ? (
              <EmptyState message="No sales in this date range. Clear the dates to see the full ledger." />
            ) : (
              <>
                <div
                  role="group"
                  aria-label="Payment method"
                  className="flex flex-wrap gap-2"
                >
                  {PAYMENT_OPTIONS.map((option) => {
                    const active = payment === option.value;
                    const counts = optionCounts[option.value];
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => changePayment(option.value)}
                        className={`press min-h-11 border px-3 text-sm font-semibold ${
                          active
                            ? "border-ink bg-ink text-paper"
                            : "border-ink/30 hover:border-ink/60 hover:bg-ink/[0.04]"
                        }`}
                      >
                        <span className="font-semibold">{option.label}</span>
                        {` · ${counts.count} ${
                          counts.count === 1 ? "sale" : "sales"
                        } · ${formatPeso(counts.total)}`}
                      </button>
                    );
                  })}
                </div>
                <p className="text-sm text-muted">
                  Newest first. Sort any column from its header.
                  {filtered.some((row) => row.voided === 1)
                    ? " Voided sales are listed but not counted."
                    : ""}
                </p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatChip
                    label="Sales"
                    value={`${paymentLive.length} ${
                      paymentLive.length === 1 ? "sale" : "sales"
                    }`}
                  />
                  <StatChip
                    label="Revenue"
                    value={formatPeso(revenueCents)}
                  />
                  <StatChip
                    label="Paid / Unpaid"
                    value={`${paidCount} / ${unpaidCount}`}
                  />
                  <StatChip
                    label="Average sale"
                    value={formatPeso(averageCents)}
                  />
                </div>
                <SalesTable
                  rows={visible}
                  label="Past sales"
                  onRowClick={(row) => setSelectedSaleId(row.id)}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  emptyMessage={
                    payment === "all"
                      ? "No sales in this date range."
                      : `No ${payment} sales in this date range.`
                  }
                />
                <footer className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    {paymentRows.length === 0
                      ? "Showing 0 of 0"
                      : `Showing ${firstIndex + 1}–${lastIndex} of ${paymentRows.length}`}
                  </p>
                  {paymentRows.length > 0 ? (
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
                  ) : null}
                </footer>
              </>
            )}
          </div>
        )}
        <SaleDetailDialog
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
        />
      </PageFrame>
    </main>
  );
}
