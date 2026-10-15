import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchSale,
  fetchSalesForDate,
  fetchSummary,
  patchSaleVoid,
  utcToday,
  type SaleRow,
} from "../api/sales";
import { formatPeso } from "../lib/formatPeso";
import { useOrders } from "../store/orders";
import SalesTable from "../components/SalesTable";

/**
 * Today's UTC-date sales popup page. Rows carry Void/Unvoid only — zero
 * Mark paid / Mark unpaid buttons: settlement lives exclusively in the
 * Order Details confirmation button on /pos.
 *
 * Each unpaid row carries a Reopen button: when a holding tab exists it is
 * selected, otherwise a tab bound to that sale is created, so orphaned
 * unpaid sales can still be settled via Order Details.
 */
export default function TodayPage() {
  const today = useMemo(() => utcToday(), []);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const orders = useOrders((s) => s.orders);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["sales", "summary", today],
    queryFn: () => fetchSummary(today),
  });
  const todaySalesQuery = useQuery({
    queryKey: ["sales", "today", today],
    queryFn: () => fetchSalesForDate(today),
  });

  const rows = todaySalesQuery.data ?? [];
  const unpaid = rows.filter((row) => row.paid !== 1);
  const paid = rows.filter((row) => row.paid === 1);
  const paidTotal = paid
    .filter((row) => row.voided !== 1)
    .reduce((sum, row) => sum + row.total_cents, 0);

  function noteFor(row: SaleRow): string | null {
    const holder = orders.find((order) => order.sale?.id === row.id);
    return holder ? holder.label : null;
  }

  async function toggleVoid(row: SaleRow) {
    if (busyId !== null) return;
    setBusyId(row.id);
    setActionError("");
    try {
      await patchSaleVoid(row.id, row.voided === 1 ? 0 : 1);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Void failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function reopen(row: SaleRow) {
    if (busyId !== null) return;
    const held = useOrders.getState().orders.find((order) => order.sale?.id === row.id);
    if (held) {
      useOrders.getState().setActive(held.key);
      navigate("/pos");
      return;
    }
    setBusyId(row.id);
    setActionError("");
    try {
      const sale = await fetchSale(row.id);
      useOrders.getState().openSaleTab(sale);
      navigate("/pos");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Reopen failed.");
    } finally {
      setBusyId(null);
    }
  }

  function actions(row: SaleRow) {
    return (
      <>
        <button
          type="button"
          aria-label={row.voided === 1 ? `Unvoid sale ${row.id}` : `Void sale ${row.id}`}
          onClick={() => void toggleVoid(row)}
          disabled={busyId !== null}
          className="border border-ink px-3 py-1 text-sm font-semibold disabled:opacity-40"
        >
          {row.voided === 1 ? "Unvoid" : "Void"}
        </button>
        {row.paid !== 1 && row.voided !== 1 ? (
          <button
            type="button"
            aria-label={`Reopen sale ${row.id}`}
            onClick={() => void reopen(row)}
            disabled={busyId !== null}
            className="border border-ink px-3 py-1 text-sm font-semibold disabled:opacity-40"
          >
            Reopen
          </button>
        ) : null}
      </>
    );
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Today &middot; {today}</h1>
          <p className="text-sm text-muted">
            Today&apos;s sales — void corrections only. Settling happens in
            Order Details on the POS.
          </p>
        </header>
        {summaryQuery.data ? (
          <p className="text-lg">
            Cash{" "}
            <span className="font-semibold text-accent">
              {formatPeso(summaryQuery.data.cash_total_cents)}
            </span>{" "}
            &middot; GCash{" "}
            <span className="font-semibold text-accent">
              {formatPeso(summaryQuery.data.gcash_total_cents)}
            </span>{" "}
            &middot; {summaryQuery.data.sale_count}{" "}
            {summaryQuery.data.sale_count === 1 ? "sale" : "sales"}
            {summaryQuery.data.voided_count > 0
              ? ` · ${summaryQuery.data.voided_count} voided`
              : ""}{" "}
            &middot; Next Order #{summaryQuery.data.next_order_number}
          </p>
        ) : summaryQuery.isLoading ? (
          <p className="text-muted">Loading today&apos;s summary…</p>
        ) : (
          <p className="text-muted">Could not load today&apos;s summary.</p>
        )}
        {actionError !== "" ? (
          <p role="alert" className="text-base">
            {actionError}
          </p>
        ) : null}
        {todaySalesQuery.isLoading ? (
          <p className="text-muted">Loading today&apos;s sales…</p>
        ) : todaySalesQuery.isError ? (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="text-lg">
              Could not load today&apos;s sales.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void todaySalesQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <section aria-label="Unpaid today" className="flex flex-col gap-4">
              <h2 className="text-2xl font-semibold">Unpaid</h2>
              {unpaid.length === 0 ? (
                <p className="text-muted">No unpaid sales.</p>
              ) : (
                <SalesTable
                  rows={unpaid}
                  label="Unpaid sales"
                  rowNote={noteFor}
                  renderActions={actions}
                />
              )}
            </section>
            <section aria-label="Paid today" className="flex flex-col gap-4">
              <h2 className="text-2xl font-semibold">Paid today</h2>
              {paid.length === 0 ? (
                <p className="text-muted">No paid sales yet.</p>
              ) : (
                <>
                  <SalesTable
                    rows={paid}
                    label="Paid today sales"
                    rowNote={noteFor}
                    renderActions={actions}
                  />
                  <p className="text-lg">
                    Paid total{" "}
                    <span className="font-semibold text-accent">
                      {formatPeso(paidTotal)}
                    </span>
                  </p>
                </>
              )}
            </section>
          </>
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
