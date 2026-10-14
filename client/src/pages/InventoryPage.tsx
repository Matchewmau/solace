import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adjustmentDelta,
  deleteStockItem,
  fetchMovements,
  fetchStockItems,
  isLowStock,
  patchStockItem,
  postStockItem,
  postStockMovement,
  type MovementReason,
  type StockItem,
} from "../api/stock";
import { formatPeso } from "../lib/formatPeso";

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading inventory">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

function readAmount(form: HTMLFormElement, field: string): number | null {
  const raw = new FormData(form).get(field);
  const value = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

interface RowControlsProps {
  item: StockItem;
  onMove: (item: StockItem, delta: number, reason: MovementReason) => void;
  pending: boolean;
  formError: string | null;
}

function RowControls({ item, onMove, pending, formError }: RowControlsProps) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-label={`Waste one ${item.name}`}
          title="Use one (waste)"
          disabled={pending}
          onClick={() => onMove(item, -1, "waste")}
          className="border border-ink px-3 py-1 text-sm font-semibold"
        >
          −1
        </button>
        <button
          type="button"
          aria-label={`Restock one ${item.name}`}
          title="Restock one (delivery)"
          disabled={pending}
          onClick={() => onMove(item, 1, "delivery")}
          className="border border-ink px-3 py-1 text-sm font-semibold"
        >
          +1
        </button>
        <form
          aria-label={`Deliver ${item.name}`}
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const amount = readAmount(event.currentTarget, "amount");
            if (amount === null || amount <= 0) return;
            onMove(item, amount, "delivery");
            event.currentTarget.reset();
          }}
        >
          <input
            name="amount"
            type="number"
            min="0"
            step="any"
            placeholder="+ qty"
            aria-label={`Delivery quantity for ${item.name}`}
            className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={pending}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Deliver
          </button>
        </form>
        <form
          aria-label={`Waste ${item.name}`}
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const amount = readAmount(event.currentTarget, "amount");
            if (amount === null || amount <= 0) return;
            onMove(item, -amount, "waste");
            event.currentTarget.reset();
          }}
        >
          <input
            name="amount"
            type="number"
            min="0"
            step="any"
            placeholder="− qty"
            aria-label={`Waste quantity for ${item.name}`}
            className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={pending}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Waste
          </button>
        </form>
        <form
          aria-label={`Set count ${item.name}`}
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const count = readAmount(event.currentTarget, "count");
            if (count === null || count < 0) return;
            const delta = adjustmentDelta(item.qty, count);
            if (delta === 0) return;
            onMove(item, delta, "adjustment");
            event.currentTarget.reset();
          }}
        >
          <input
            name="count"
            type="number"
            min="0"
            step="any"
            placeholder="new count"
            aria-label={`New count for ${item.name}`}
            className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <button
            type="submit"
            disabled={pending}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Set count
          </button>
        </form>
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-accent">
          {formError}
        </p>
      ) : null}
    </div>
  );
}

interface EditPatch {
  name: string;
  unit: string;
  low_threshold: number;
  price_cents: number;
}

interface EditDialogProps {
  item: StockItem;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (id: number, patch: EditPatch) => void;
}

/**
 * Catalog edit dialog: name, price, unit, threshold only. qty is NEVER
 * shown or sent here — counts only change through the movements ledger.
 */
function EditDialog({ item, pending, error, onClose, onSave }: EditDialogProps) {
  const pricePesos =
    item.price_cents % 100 === 0
      ? String(item.price_cents / 100)
      : (item.price_cents / 100).toFixed(2);
  return (
    <div
      role="dialog"
      aria-label={`Edit ${item.name}`}
      className="mt-2 border border-ink/20 p-3"
    >
      <form
        aria-label={`Edit ${item.name} form`}
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get("name") ?? "").trim();
          const unit = String(data.get("unit") ?? "");
          const priceValue = Number(String(data.get("price") ?? ""));
          const thresholdRaw = String(data.get("threshold") ?? "");
          const low_threshold =
            thresholdRaw === "" ? 0 : Number(thresholdRaw);
          if (name === "") return;
          if (!Number.isFinite(priceValue) || priceValue < 0) return;
          if (!Number.isFinite(low_threshold) || !Number.isInteger(low_threshold) || low_threshold < 0) return;
          onSave(item.id, {
            name,
            unit,
            low_threshold,
            price_cents: Math.round(priceValue * 100),
          });
        }}
      >
        <input
          name="name"
          type="text"
          required
          defaultValue={item.name}
          placeholder="Item name"
          aria-label="Item name"
          className="w-32 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <input
          name="price"
          type="number"
          min="0"
          step="any"
          required
          defaultValue={pricePesos}
          placeholder="Price (₱)"
          aria-label="Price in pesos"
          className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <input
          name="unit"
          type="text"
          defaultValue={item.unit}
          placeholder="Unit"
          aria-label="Unit"
          className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <input
          name="threshold"
          type="number"
          min="0"
          step="1"
          defaultValue={item.low_threshold}
          placeholder="Threshold"
          aria-label="Low threshold"
          className="w-28 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="border border-ink px-3 py-1 text-sm font-semibold"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="border border-ink/20 px-3 py-1 text-sm"
        >
          Cancel
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-accent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(
    null,
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{
    id: number;
    message: string;
  } | null>(null);
  const addFormRef = useRef<HTMLFormElement | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["stock-items"],
    queryFn: fetchStockItems,
  });
  const movementsQuery = useQuery({
    queryKey: ["stock-movements", selectedId],
    queryFn: () => fetchMovements(selectedId as number),
    enabled: selectedId !== null,
  });

  const moveMutation = useMutation({
    mutationFn: ({
      item,
      delta,
      reason,
    }: {
      item: StockItem;
      delta: number;
      reason: MovementReason;
    }) => postStockMovement(item.id, delta, reason),
    onSuccess: (_data, variables) => {
      setMoveError(null);
      void queryClient.invalidateQueries({ queryKey: ["stock-items"] });
      if (selectedId === variables.item.id) {
        void queryClient.invalidateQueries({
          queryKey: ["stock-movements", selectedId],
        });
      }
    },
    onError: () => {
      setMoveError("Could not record that movement.");
    },
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      name: string;
      unit: string;
      qty: number;
      low_threshold: number;
    }) => postStockItem(input),
    onSuccess: () => {
      setAddError(null);
      addFormRef.current?.reset();
      void queryClient.invalidateQueries({ queryKey: ["stock-items"] });
    },
    onError: () => {
      setAddError("Could not add that stock item.");
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: EditPatch }) =>
      patchStockItem(id, patch),
    onSuccess: () => {
      setEditError(null);
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["stock-items"] });
    },
    onError: () => {
      setEditError("Could not save those changes.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: StockItem) => deleteStockItem(item.id),
    onSuccess: (_data, item) => {
      setDeleteError(null);
      setConfirmingDeleteId(null);
      if (selectedId === item.id) setSelectedId(null);
      if (editingId === item.id) setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["stock-items"] });
    },
    onError: (err, item) => {
      const detail = err instanceof Error ? err.message : "request failed";
      setDeleteError({ id: item.id, message: `Could not delete ${item.name}: ${detail}` });
    },
  });

  const items = itemsQuery.data ?? [];
  const lowItems = items.filter(isLowStock);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted">Stock counts and movements.</p>
        </header>
        {itemsQuery.isLoading ? (
          <LoadingSkeleton />
        ) : itemsQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load inventory.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void itemsQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <section aria-label="New stock item">
              <p className="label text-xs text-muted">Solace &middot; New item</p>
              <h2 className="mt-2 text-2xl font-semibold">Add stock item</h2>
              <form
                ref={addFormRef}
                aria-label="Add stock item"
                className="mt-4 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const name = String(data.get("name") ?? "").trim();
                  const unit = String(data.get("unit") ?? "");
                  const qtyRaw = String(data.get("qty") ?? "");
                  const thresholdRaw = String(data.get("threshold") ?? "");
                  const qty = qtyRaw === "" ? 0 : Number(qtyRaw);
                  const low_threshold =
                    thresholdRaw === "" ? 0 : Number(thresholdRaw);
                  if (name === "") return;
                  if (!Number.isFinite(qty) || qty < 0) return;
                  if (!Number.isFinite(low_threshold) || low_threshold < 0)
                    return;
                  addMutation.mutate({ name, unit, qty, low_threshold });
                }}
              >
                <input
                  name="name"
                  type="text"
                  required
                  placeholder="Item name"
                  aria-label="Stock item name"
                  className="w-32 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
                />
                <input
                  name="unit"
                  type="text"
                  required
                  placeholder="Unit"
                  aria-label="Stock item unit"
                  className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
                />
                <input
                  name="qty"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Qty (0)"
                  aria-label="Stock item quantity"
                  className="w-24 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
                />
                <input
                  name="threshold"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Threshold (0)"
                  aria-label="Stock item threshold"
                  className="w-28 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
                />
                <button
                  type="submit"
                  disabled={addMutation.isPending}
                  className="border border-ink px-3 py-1 text-sm font-semibold"
                >
                  Add item
                </button>
              </form>
              {addError ? (
                <p role="alert" className="mt-2 text-sm text-accent">
                  {addError}
                </p>
              ) : null}
            </section>
            {items.length === 0 ? (
              <p className="py-8 text-center text-muted">No stock items yet</p>
            ) : (
          <div className="flex flex-col gap-10">
            <section aria-label="Low stock">
              <p className="label text-xs text-muted">Solace &middot; Low stock</p>
              <h2 className="mt-2 text-2xl font-semibold">Low stock</h2>
              {lowItems.length === 0 ? (
                <p className="mt-4 text-muted">Nothing is low right now.</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-2">
                  {lowItems.map((item) => (
                    <li key={item.id} className="text-base">
                      {item.name} — {item.qty} {item.unit} (threshold{" "}
                      {item.low_threshold}){" "}
                      <span className="font-semibold text-accent">LOW</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Stock">
              <p className="label text-xs text-muted">Solace &middot; Stock</p>
              <h2 className="mt-2 text-2xl font-semibold">Stock</h2>
              <ul className="mt-4 flex flex-col gap-6">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-1 border-b border-ink/10 pb-4"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-lg font-semibold">{item.name}</span>
                      <span className="text-base font-semibold text-accent">
                        {formatPeso(item.price_cents)}
                      </span>
                      <span className="text-base">
                        {item.qty}
                        {item.unit ? ` ${item.unit}` : ""} (threshold{" "}
                        {item.low_threshold})
                      </span>
                      {isLowStock(item) ? (
                        <span className="border border-accent px-2 py-0.5 text-xs font-semibold text-accent">
                          LOW
                        </span>
                      ) : null}
                      <span className="ml-auto flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedId(selectedId === item.id ? null : item.id)
                          }
                          aria-pressed={selectedId === item.id}
                          aria-label={
                            selectedId === item.id
                              ? `Hide history for ${item.name}`
                              : `Show history for ${item.name}`
                          }
                          className="border border-ink/20 px-3 py-1 text-sm"
                        >
                          {selectedId === item.id ? "Hide history" : "History"}
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => {
                            setEditingId(item.id);
                            setEditError(null);
                          }}
                          className="border border-ink/20 px-3 py-1 text-sm"
                        >
                          Edit
                        </button>
                        {confirmingDeleteId === item.id ? (
                          <>
                            <button
                              type="button"
                              aria-label={`Confirm delete ${item.name}`}
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(item)}
                              className="border border-accent px-3 py-1 text-sm font-semibold text-accent"
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              aria-label={`Cancel delete ${item.name}`}
                              onClick={() => setConfirmingDeleteId(null)}
                              className="border border-ink/20 px-3 py-1 text-sm"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete ${item.name}`}
                            onClick={() => {
                              setConfirmingDeleteId(item.id);
                              setDeleteError(null);
                            }}
                            className="border border-ink/20 px-3 py-1 text-sm"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                    <RowControls
                      item={item}
                      pending={moveMutation.isPending}
                      formError={moveError}
                      onMove={(target, delta, reason) =>
                        moveMutation.mutate({ item: target, delta, reason })
                      }
                    />
                    {deleteError !== null && deleteError.id === item.id ? (
                      <p role="alert" className="text-sm text-accent">
                        {deleteError.message}
                      </p>
                    ) : null}
                    {editingId === item.id ? (
                      <EditDialog
                        item={item}
                        pending={editMutation.isPending}
                        error={editError}
                        onClose={() => {
                          setEditingId(null);
                          setEditError(null);
                        }}
                        onSave={(id, patch) =>
                          editMutation.mutate({ id, patch })
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            {selected !== null ? (
              <section aria-label={`History for ${selected.name}`}>
                <p className="label text-xs text-muted">Solace &middot; History</p>
                <h2 className="mt-2 text-2xl font-semibold">
                  History — {selected.name}
                </h2>
                {movementsQuery.isLoading ? (
                  <p className="mt-4 text-muted" aria-busy="true">
                    Loading history…
                  </p>
                ) : movementsQuery.isError ? (
                  <div className="mt-4 flex flex-col items-start gap-4">
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
                ) : (movementsQuery.data ?? []).length === 0 ? (
                  <p className="mt-4 text-muted">No movements recorded.</p>
                ) : (
                  <ul className="mt-4 flex flex-col gap-2">
                    {(movementsQuery.data ?? []).map((movement) => (
                      <li key={movement.id} className="text-base">
                        {movement.reason} {movement.delta} —{" "}
                        {movement.created_at}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}
          </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
