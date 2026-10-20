import { useQuery } from "@tanstack/react-query";
import { fetchSale, type Sale } from "../api/sales";
import { formatPeso } from "../lib/formatPeso";
import { formatVariantLabel } from "../lib/variants";
import { Badge, Button } from "./ui";
import { Dialog } from "./Dialog";

/** Status precedence shared with SalesTable: voided wins over paid. */
function statusBadge(sale: Sale) {
  if (sale.voided === 1) return <Badge tone="neutral">Voided</Badge>;
  if (sale.paid === 1) return <Badge tone="ok">Paid</Badge>;
  return <Badge tone="danger">Unpaid</Badge>;
}

/**
 * Read-only receipt for one sale. Today and History pass the clicked row's
 * id; the dialog fetches GET /api/sales/:id (which joins menu item names) so
 * the ledger stays lightweight and the details never come from stale rows.
 */
export default function SaleDetailDialog({
  saleId,
  onClose,
}: {
  saleId: number | null;
  onClose: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["sales", "detail", saleId],
    queryFn: () => fetchSale(saleId as number),
    enabled: saleId !== null,
  });
  const title = saleId === null ? "Sale details" : `Sale #${saleId}`;

  return (
    <Dialog open={saleId !== null} onClose={onClose} title={title}>
      <div className="flex items-start justify-between gap-4">
        <p className="label text-xs text-muted">Solace &middot; Sale</p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      {detailQuery.isLoading ? (
        <p className="mt-4 text-muted" aria-busy="true">
          Loading sale…
        </p>
      ) : detailQuery.isError ? (
        <div className="mt-4 flex flex-col items-start gap-4">
          <p role="alert" className="text-base">
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "Could not load this sale."}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              void detailQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : detailQuery.data ? (
        <div className="mt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <div className="flex items-center gap-2">
              {statusBadge(detailQuery.data)}
              <span className="text-sm font-semibold">
                {detailQuery.data.payment === "cash" ? "Cash" : "GCash"}
              </span>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">
            {detailQuery.data.created_at.slice(0, 10)} &middot;{" "}
            {detailQuery.data.created_at.slice(11, 16)}
          </p>
          <ul className="mt-5 flex flex-col gap-2">
            {detailQuery.data.items.map((line) => (
              <li
                key={line.id}
                className="flex items-baseline justify-between gap-4 border-b border-ink/10 pb-2"
              >
                <span className="text-base font-semibold">
                  {formatVariantLabel(
                    line.menu_item_name ?? `Item #${line.menu_item_id}`,
                    line.variant,
                  )}{" "}
                  × {line.qty}
                </span>
                <span className="text-base text-accent">
                  {formatPeso(line.unit_price_cents * line.qty)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 flex flex-col gap-1 text-base">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="font-semibold">Total</dt>
              <dd className="text-lg font-semibold text-accent">
                {formatPeso(detailQuery.data.total_cents)}
              </dd>
            </div>
            {detailQuery.data.payment === "cash" &&
            detailQuery.data.received_cents != null ? (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <dt>Received</dt>
                  <dd>{formatPeso(detailQuery.data.received_cents)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt>Change</dt>
                  <dd>{formatPeso(detailQuery.data.change_cents ?? 0)}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </Dialog>
  );
}
