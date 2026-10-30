import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adjustmentDelta,
  deleteStockItem,
  fetchStockItems,
  isLowStock,
  patchStockItem,
  postStockItem,
  postStockMovement,
  type MovementReason,
  type StockItem,
} from "../api/stock";
import { formatPeso } from "../lib/formatPeso";
import { canonicalUnit } from "../lib/units";
import DataTable, { type Column } from "../components/DataTable";
import { Dialog } from "../components/Dialog";
import { Field } from "../components/Field";
import { UnitSelect } from "../components/UnitSelect";
import { Badge, Box, Button, PageFrame, StatChip } from "../components/ui";

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading inventory">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/** The four movement kinds, in the order the dialog offers them. */
const MOVEMENT_OPTIONS: { value: MovementReason; label: string }[] = [
  { value: "delivery", label: "Add stock" },
  { value: "used", label: "Used" },
  { value: "waste", label: "Waste" },
  { value: "adjustment", label: "Count correction" },
];

interface MovementDialogProps {
  item: StockItem;
  initialReason: MovementReason;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onRecord: (
    item: StockItem,
    delta: number,
    reason: MovementReason,
    note?: string,
  ) => void;
}

/**
 * Record a stock movement: Add (delivery) adds, Used/Waste subtract, Count
 * correction records the difference to a new counted total. qty is never
 * written directly — every change travels through the movements ledger.
 * A live preview shows the resulting count and outbound movements that
 * would take stock below zero are blocked locally.
 */
function MovementDialog({
  item,
  initialReason,
  pending,
  error,
  onClose,
  onRecord,
}: MovementDialogProps) {
  const [reason, setReason] = useState<MovementReason>(initialReason);
  const [qtyText, setQtyText] = useState("");
  const isSetCount = reason === "adjustment";
  const noteLabel = reason === "used" ? "Used for" : "Note";
  const notePlaceholder =
    reason === "used"
      ? "Cafe/Food note (e.g. 2 lattes)"
      : "Optional note";
  const entered = Number(qtyText);
  const qtyEntered =
    qtyText.trim() !== "" && Number.isFinite(entered) && entered >= 0;
  const result = isSetCount
    ? entered
    : reason === "delivery"
      ? item.qty + entered
      : item.qty - entered;
  const outboundOverStock =
    (reason === "used" || reason === "waste") && entered > item.qty;
  // Unit-aware, reason-aware quantity hint; no dangling unit clause when the
  // item carries no unit ("Amount added" rather than "Amount added, in ").
  const unitClause = item.unit === "" ? "" : `, in ${item.unit}`;
  const qtyHint =
    reason === "adjustment"
      ? `New counted total${unitClause}`
      : reason === "used"
        ? `Amount used${unitClause}`
        : reason === "waste"
          ? `Amount wasted${unitClause}`
          : `Amount added${unitClause}`;

  return (
    <Dialog open onClose={onClose} title={`Record movement — ${item.name}`}>
      <form
        aria-label={`Record movement for ${item.name}`}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const selected = String(data.get("reason") ?? "delivery") as MovementReason;
          const qty = Number(String(data.get("qty") ?? ""));
          const note = String(data.get("note") ?? "").trim();
          if (!Number.isFinite(qty) || qty < 0) return;
          if (selected === "adjustment") {
            const delta = adjustmentDelta(item.qty, qty);
            if (delta === 0) return;
            onRecord(item, delta, "adjustment", note);
            return;
          }
          if (qty <= 0) return;
          const outbound = selected === "waste" || selected === "used";
          if (outbound && qty > item.qty) return;
          onRecord(item, outbound ? -qty : qty, selected, note);
        }}
      >
        <Field
          label="Type"
          hint="Add stock, use, waste, or correct the count."
        >
          <select
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as MovementReason)}
            aria-label="Movement type"
            className="field"
          >
            {MOVEMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" hint={qtyHint}>
          <input
            name="qty"
            type="number"
            min="0"
            step="any"
            required
            value={qtyText}
            onChange={(event) => setQtyText(event.target.value)}
            placeholder={isSetCount ? "New count" : "Qty"}
            aria-label="Quantity"
            className="field"
          />
        </Field>
        <Field
          label={noteLabel}
          hint="Optional detail for the history entry."
        >
          <input
            name="note"
            type="text"
            maxLength={120}
            placeholder={notePlaceholder}
            aria-label={noteLabel}
            className="field"
          />
        </Field>
        <p className="text-sm text-muted">
          {!qtyEntered
            ? `Current stock: ${item.qty} ${item.unit}`
            : outboundOverStock
              ? `Only ${item.qty} ${item.unit} in stock.`
              : `After saving: ${result} ${item.unit}`}
        </p>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
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
 * Catalog edit dialog: name, price, unit, threshold only. qty is never
 * editable — counts only change through the movements ledger, so the
 * current quantity is shown read-only and qty is never sent.
 */
function EditDialog({ item, pending, error, onClose, onSave }: EditDialogProps) {
  const pricePesos =
    item.price_cents % 100 === 0
      ? String(item.price_cents / 100)
      : (item.price_cents / 100).toFixed(2);
  const [unit, setUnit] = useState(canonicalUnit(item.unit));
  return (
    <Dialog open onClose={onClose} title={`Edit ${item.name}`}>
      <form
        aria-label={`Edit ${item.name} form`}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get("name") ?? "").trim();
          const unitValue = String(data.get("unit") ?? "");
          const priceValue = Number(String(data.get("price") ?? ""));
          const thresholdRaw = String(data.get("threshold") ?? "");
          const low_threshold = thresholdRaw === "" ? 0 : Number(thresholdRaw);
          if (name === "") return;
          if (!Number.isFinite(priceValue) || priceValue < 0) return;
          if (!Number.isFinite(low_threshold) || !Number.isInteger(low_threshold) || low_threshold < 0) return;
          onSave(item.id, {
            name,
            unit: unitValue,
            low_threshold,
            price_cents: Math.round(priceValue * 100),
          });
        }}
      >
        <p className="text-sm text-muted">
          Current quantity: {item.qty} {canonicalUnit(item.unit)}. Quantity
          changes through Add, Use, or Count.
        </p>
        <Field label="Item name">
          <input
            name="name"
            type="text"
            required
            defaultValue={item.name}
            aria-label="Item name"
            className="field"
          />
        </Field>
        <Field label="Unit">
          <UnitSelect
            name="unit"
            value={unit}
            onChange={setUnit}
            ariaLabel="Unit"
          />
        </Field>
        <Field label="Price per unit (₱)">
          <input
            name="price"
            type="number"
            min="0"
            step="any"
            required
            defaultValue={pricePesos}
            aria-label="Price per unit in pesos"
            className="field"
          />
        </Field>
        <Field label="Low-stock threshold">
          <input
            name="threshold"
            type="number"
            min="0"
            step="1"
            defaultValue={item.low_threshold}
            aria-label="Low-stock threshold"
            className="field"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

interface AddItemDialogProps {
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onAdd: (input: {
    name: string;
    unit: string;
    qty: number;
    low_threshold: number;
    price_cents: number;
  }) => void;
}

/** Add dialog: the same five catalog fields the always-open form carried. */
function AddItemDialog({ pending, error, onClose, onAdd }: AddItemDialogProps) {
  const [unit, setUnit] = useState("");
  return (
    <Dialog open onClose={onClose} title="Add stock item">
      <form
        aria-label="Add stock item form"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get("name") ?? "").trim();
          const unitValue = String(data.get("unit") ?? "");
          const qtyRaw = String(data.get("qty") ?? "");
          const priceRaw = String(data.get("price") ?? "");
          const thresholdRaw = String(data.get("threshold") ?? "");
          const qty = qtyRaw === "" ? 0 : Number(qtyRaw);
          const price = priceRaw === "" ? 0 : Number(priceRaw);
          const low_threshold = thresholdRaw === "" ? 0 : Number(thresholdRaw);
          if (name === "") return;
          if (!Number.isFinite(qty) || qty < 0) return;
          if (!Number.isFinite(price) || price < 0) return;
          if (!Number.isFinite(low_threshold) || low_threshold < 0) return;
          onAdd({
            name,
            unit: unitValue,
            qty,
            low_threshold,
            price_cents: Math.round(price * 100),
          });
        }}
      >
        <Field label="Item name">
          <input
            name="name"
            type="text"
            required
            aria-label="Item name"
            className="field"
          />
        </Field>
        <Field label="Unit">
          <UnitSelect
            name="unit"
            value={unit}
            onChange={setUnit}
            ariaLabel="Unit"
          />
        </Field>
        <Field label="Starting quantity">
          <input
            name="qty"
            type="number"
            min="0"
            step="any"
            placeholder="0"
            aria-label="Starting quantity"
            className="field"
          />
        </Field>
        <Field label="Price per unit (₱)">
          <input
            name="price"
            type="number"
            min="0"
            step="any"
            aria-label="Price per unit in pesos"
            className="field"
          />
        </Field>
        <Field label="Low-stock threshold">
          <input
            name="threshold"
            type="number"
            min="0"
            step="any"
            placeholder="0"
            aria-label="Low-stock threshold"
            className="field"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            Add item
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [movementItem, setMovementItem] = useState<StockItem | null>(null);
  const [movementReason, setMovementReason] =
    useState<MovementReason>("delivery");
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(
    null,
  );
  const [moveError, setMoveError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{
    id: number;
    message: string;
  } | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["stock-items"],
    queryFn: fetchStockItems,
  });

  const moveMutation = useMutation({
    mutationFn: ({
      item,
      delta,
      reason,
      note,
    }: {
      item: StockItem;
      delta: number;
      reason: MovementReason;
      note?: string;
    }) => postStockMovement(item.id, delta, reason, note),
    onSuccess: () => {
      setMoveError(null);
      setMovementItem(null);
      void queryClient.invalidateQueries({ queryKey: ["stock-items"] });
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
      price_cents: number;
    }) => postStockItem(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
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
      setEditingItem(null);
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
      if (editingItem?.id === item.id) setEditingItem(null);
      void queryClient.invalidateQueries({ queryKey: ["stock-items"] });
    },
    onError: (err, item) => {
      const detail = err instanceof Error ? err.message : "request failed";
      setDeleteError({ id: item.id, message: `Could not delete ${item.name}: ${detail}` });
    },
  });

  const items = itemsQuery.data ?? [];
  const lowCount = items.filter(isLowStock).length;
  const totalValueCents = items.reduce(
    (sum, item) => sum + Math.round(item.qty * item.price_cents),
    0,
  );
  const needle = query.trim().toLowerCase();
  const visibleItems =
    needle === ""
      ? items
      : items.filter((item) => item.name.toLowerCase().includes(needle));

  const columns: Column<StockItem>[] = [
    { key: "item", label: "Item", render: (item) => item.name },
    {
      key: "unit",
      label: "Unit",
      render: (item) => canonicalUnit(item.unit),
    },
    { key: "qty", label: "Qty", align: "right", render: (item) => item.qty },
    {
      key: "threshold",
      label: "Threshold",
      align: "right",
      render: (item) => item.low_threshold,
    },
    {
      key: "unit_price",
      label: "Unit price",
      align: "right",
      render: (item) => formatPeso(item.price_cents),
    },
    {
      key: "value",
      label: "Value",
      align: "right",
      render: (item) => formatPeso(Math.round(item.qty * item.price_cents)),
    },
    {
      key: "status",
      label: "Status",
      render: (item) =>
        isLowStock(item) ? (
          <Badge tone="danger">Low</Badge>
        ) : (
          <Badge tone="neutral">OK</Badge>
        ),
    },
  ];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="page-title">Inventory</h1>
          <p className="text-sm text-muted">Stock counts and movements.</p>
        </header>
        {itemsQuery.isLoading ? (
          <LoadingSkeleton />
        ) : itemsQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load inventory.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void itemsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatChip label="Total value" value={formatPeso(totalValueCents)} />
              <StatChip
                label="Low stock"
                value={lowCount}
                tone={lowCount > 0 ? "danger" : "default"}
              />
              <StatChip label="Items" value={items.length} />
            </div>
            <Box className="flex flex-wrap items-end gap-4">
              <label className="flex flex-1 flex-col gap-2">
                <span className="label text-xs text-muted">Search stock</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search stock…"
                  aria-label="Search stock"
                  className="field"
                />
              </label>
              <Button
                variant="primary"
                onClick={() => {
                  setAddError(null);
                  setAddOpen(true);
                }}
              >
                + Add item
              </Button>
            </Box>
            <DataTable
              label="Stock"
              columns={columns}
              rows={visibleItems}
              rowKey={(item) => item.id}
              emptyMessage={
                items.length === 0
                  ? "No stock items yet"
                  : "No items match your search."
              }
              renderActions={(item) => (
                <>
                  <Button
                    variant="outline"
                    ariaLabel={`Add ${item.name}`}
                    onClick={() => {
                      setMoveError(null);
                      setMovementReason("delivery");
                      setMovementItem(item);
                    }}
                  >
                    Add
                  </Button>
                  <Button
                    variant="outline"
                    ariaLabel={`Use ${item.name}`}
                    onClick={() => {
                      setMoveError(null);
                      setMovementReason("used");
                      setMovementItem(item);
                    }}
                  >
                    Use
                  </Button>
                  <Button
                    variant="outline"
                    ariaLabel={`Count ${item.name}`}
                    onClick={() => {
                      setMoveError(null);
                      setMovementReason("adjustment");
                      setMovementItem(item);
                    }}
                  >
                    Count
                  </Button>
                  <Link
                    to={`/inventory/history?item=${item.id}`}
                    aria-label={`Show history for ${item.name}`}
                    className="action-link gap-2"
                  >
                    History
                  </Link>
                  <Button
                    variant="outline"
                    ariaLabel={`Edit ${item.name}`}
                    onClick={() => {
                      setEditingItem(item);
                      setEditError(null);
                    }}
                  >
                    Edit
                  </Button>
                  {confirmingDeleteId === item.id ? (
                    <>
                      <Button
                        variant="danger"
                        disabled={deleteMutation.isPending}
                        ariaLabel={`Confirm delete ${item.name}`}
                        onClick={() => deleteMutation.mutate(item)}
                      >
                        Confirm delete
                      </Button>
                      <Button
                        variant="outline"
                        ariaLabel={`Cancel delete ${item.name}`}
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      ariaLabel={`Delete ${item.name}`}
                      onClick={() => {
                        setConfirmingDeleteId(item.id);
                        setDeleteError(null);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </>
              )}
            />
            {deleteError ? (
              <p role="alert" className="text-sm text-accent">
                {deleteError.message}
              </p>
            ) : null}
          </div>
        )}
      </PageFrame>
      {movementItem ? (
        <MovementDialog
          key={movementItem.id}
          item={movementItem}
          initialReason={movementReason}
          pending={moveMutation.isPending}
          error={moveError}
          onClose={() => {
            setMovementItem(null);
            setMoveError(null);
          }}
          onRecord={(item, delta, reason, note) =>
            moveMutation.mutate({ item, delta, reason, note })
          }
        />
      ) : null}
      {editingItem ? (
        <EditDialog
          key={editingItem.id}
          item={editingItem}
          pending={editMutation.isPending}
          error={editError}
          onClose={() => {
            setEditingItem(null);
            setEditError(null);
          }}
          onSave={(id, patch) => editMutation.mutate({ id, patch })}
        />
      ) : null}
      {addOpen ? (
        <AddItemDialog
          pending={addMutation.isPending}
          error={addError}
          onClose={() => {
            setAddOpen(false);
            setAddError(null);
          }}
          onAdd={(input) => addMutation.mutate(input)}
        />
      ) : null}
    </main>
  );
}
