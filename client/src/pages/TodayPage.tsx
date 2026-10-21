import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import SaleDetailDialog from "../components/SaleDetailDialog";
import SalesTable from "../components/SalesTable";
import { Badge, Button, EmptyState, PageFrame, StatChip } from "../components/ui";

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
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);

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

  // Readability strip uses only live rows (voided sales never count).
  const liveRows = rows.filter((row) => row.voided !== 1);
  const paidLive = liveRows.filter((row) => row.paid === 1);
  const unpaidLive = liveRows.filter((row) => row.paid !== 1);
  const summary = summaryQuery.data;
  const averageCents =
    liveRows.length > 0
      ? Math.round(
          liveRows.reduce((sum, row) => sum + row.total_cents, 0) /
            liveRows.length,
        )
      : summary !== undefined && summary.sale_count > 0
        ? Math.round(
            (summary.cash_total_cents + summary.gcash_total_cents) /
              summary.sale_count,
          )
        : 0;

  function countLabel(count: number, singular: string): string {
    return `${count} ${count === 1 ? singular : `${singular}s`}`;
  }

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
        <Button
          variant="outline"
          ariaLabel={
            row.voided === 1 ? `Unvoid sale ${row.id}` : `Void sale ${row.id}`
          }
          onClick={() => void toggleVoid(row)}
          disabled={busyId !== null}
        >
          {row.voided === 1 ? "Unvoid" : "Void"}
        </Button>
        {row.paid !== 1 && row.voided !== 1 ? (
          <Button
            variant="outline"
            ariaLabel={`Reopen sale ${row.id}`}
            onClick={() => void reopen(row)}
            disabled={busyId !== null}
          >
            Reopen
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="page-title">Today &middot; {today}</h1>
          <p className="text-sm text-muted">
            Today&apos;s sales — void corrections only. Settling happens in
            Order Details on the POS.
          </p>
        </header>
        {summaryQuery.data ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatChip
                label="Cash"
                value={formatPeso(summaryQuery.data.cash_total_cents)}
              />
              <StatChip
                label="GCash"
                value={formatPeso(summaryQuery.data.gcash_total_cents)}
              />
              <StatChip
                label="Sales"
                value={`${summaryQuery.data.sale_count} ${
                  summaryQuery.data.sale_count === 1 ? "sale" : "sales"
                }${
                  summaryQuery.data.voided_count > 0
                    ? ` · ${summaryQuery.data.voided_count} voided`
                    : ""
                }`}
              />
              <StatChip
                label="Next Order"
                value={`#${summaryQuery.data.next_order_number}`}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatChip
                label="Paid sales"
                value={countLabel(paidLive.length, "sale")}
                tone="ok"
              />
              <StatChip
                label="Unpaid sales"
                value={countLabel(unpaidLive.length, "sale")}
                tone={unpaidLive.length > 0 ? "danger" : "default"}
              />
              <StatChip
                label="Average sale"
                value={formatPeso(averageCents)}
              />
            </div>
          </div>
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
            <Button
              variant="outline"
              onClick={() => {
                void todaySalesQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <section aria-label="Unpaid today" className="flex flex-col gap-4">
              <h2 className="flex items-center gap-3 text-2xl font-semibold">
                Unpaid
                <Badge tone="danger">{unpaid.length}</Badge>
              </h2>
              {unpaid.length === 0 ? (
                <EmptyState message="No unpaid sales — every tab is settled." />
              ) : (
                <SalesTable
                  rows={unpaid}
                  label="Unpaid sales"
                  rowNote={noteFor}
                  renderActions={actions}
                  onRowClick={(row) => setSelectedSaleId(row.id)}
                />
              )}
            </section>
            <section aria-label="Paid today" className="flex flex-col gap-4">
              <h2 className="text-2xl font-semibold">Paid today</h2>
              {paid.length === 0 ? (
                <EmptyState message="No paid sales yet — settle an order on the POS to see it here." />
              ) : (
                <>
                  <SalesTable
                    rows={paid}
                    label="Paid today sales"
                    rowNote={noteFor}
                    renderActions={actions}
                    onRowClick={(row) => setSelectedSaleId(row.id)}
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
        <SaleDetailDialog
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
        />
      </PageFrame>
    </main>
  );
}
