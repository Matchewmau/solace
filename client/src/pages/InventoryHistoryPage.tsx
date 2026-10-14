import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMovements } from "../api/stock";

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

  const movements = movementsQuery.data ?? [];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
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
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void movementsQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : movements.length === 0 ? (
          <p className="text-muted">No movements recorded.</p>
        ) : (
          <table
            aria-label="Movement history"
            className="w-full border-collapse text-left text-base"
          >
            <thead>
              <tr className="border-b border-ink/20">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Reason
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Change
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id} className="border-b border-ink/10">
                  <td className="py-2 pr-4">{movement.reason}</td>
                  <td className="py-2 pr-4">{movement.delta}</td>
                  <td className="py-2">{movement.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </div>
    </main>
  );
}
