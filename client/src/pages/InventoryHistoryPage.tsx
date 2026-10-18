import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMovements, type StockMovement } from "../api/stock";
import DataTable, { type Column } from "../components/DataTable";
import { Button, PageFrame } from "../components/ui";

/**
 * Dedicated movement history for one stock item (?item=<id>).
 * Owns the ledger read so InventoryPage stays a counts-and-controls list.
 * Motion-free: this route is eager (see the routes.tsx chunk-split note).
 */
export default function InventoryHistoryPage() {
  const [params] = useSearchParams();
  const raw = params.get("item");
  const itemId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

  const movementsQuery = useQuery({
    queryKey: ["stock-movements", itemId],
    queryFn: () => fetchMovements(itemId as number),
    enabled: itemId !== null,
  });

  const columns: Column<StockMovement>[] = [
    { key: "reason", label: "Reason", render: (movement) => movement.reason },
    { key: "change", label: "Change", render: (movement) => movement.delta },
    {
      key: "date",
      label: "Date",
      sortable: true,
      value: (movement) => movement.created_at,
      render: (movement) => movement.created_at,
    },
  ];

  const movements = movementsQuery.data ?? [];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="text-4xl font-semibold">Inventory history</h1>
          <p className="text-sm text-muted">
            {itemId === null
              ? "Stock movements ledger."
              : `Movements for item #${itemId}.`}
          </p>
        </header>
        {itemId === null ? (
          <p role="alert" className="text-lg">
            Unknown item.
          </p>
        ) : movementsQuery.isLoading ? (
          <p className="text-muted" aria-busy="true">
            Loading history…
          </p>
        ) : movementsQuery.isError ? (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="text-lg">
              Could not load history.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void movementsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Movement history"
            columns={columns}
            rows={movements}
            rowKey={(movement) => movement.id}
            emptyMessage="No movements recorded."
          />
        )}
        <div>
          <Link
            to="/inventory"
            aria-label="Back to inventory"
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            ← Back to inventory
          </Link>
        </div>
      </PageFrame>
    </main>
  );
}
