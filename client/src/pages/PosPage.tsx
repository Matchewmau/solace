import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchActiveMenuItems,
  fetchCategories,
  type MenuItem,
} from "../api/menu";
import { patchSalePaid, postSale, putSaleItems, utcToday } from "../api/sales";
import { formatPeso } from "../lib/formatPeso";
import { formatVariantLabel } from "../lib/variants";
import { cartTotalCents, useOrders } from "../store/orders";
import { sortCategories } from "../lib/sortCategories";

const methodButton = (pressed: boolean) =>
  pressed
    ? "flex-1 bg-ink px-4 py-4 text-lg font-semibold text-paper"
    : "flex-1 border border-ink px-4 py-4 text-lg font-semibold";

/** Unique cart-line key; line identity is item plus chosen variant. */
const lineKey = (line: { menu_item_id: number; variant: string | null }) =>
  `${line.menu_item_id}:${line.variant ?? ""}`;

export default function PosPage() {
  const orders = useOrders((s) => s.orders);
  const activeKey = useOrders((s) => s.activeKey);
  const addOrder = useOrders((s) => s.addOrder);
  const closeOrder = useOrders((s) => s.closeOrder);
  const setActive = useOrders((s) => s.setActive);
  const addItem = useOrders((s) => s.addItem);
  const setQty = useOrders((s) => s.setQty);
  const removeLine = useOrders((s) => s.removeLine);
  const setPayment = useOrders((s) => s.setPayment);
  const completeOrder = useOrders((s) => s.completeOrder);
  const updateSale = useOrders((s) => s.updateSale);
  const reopenForEdit = useOrders((s) => s.reopenForEdit);

  const active = orders.find((order) => order.key === activeKey) ?? orders[0];

  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  // Variant choice prompt: set from a tap on an item with variants; the
  // tab only grows a line when a choice is made (Cancel adds nothing).
  const [promptItem, setPromptItem] = useState<MenuItem | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // Finalized-tab ops (PUT items, Mark paid/unpaid) share one busy flag +
  // one error line so overlapping detail writes cannot interleave.
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  // Sync re-entry guard: two clicks before the pending re-render still
  // post only once. The done-status check below blocks any later click.
  const checkoutBusy = useRef(false);

  // UTC-date order header (Task 8): the day boundary is the UTC calendar
  // date, matching GET /api/sales/summary. Shop hours 2pm-10pm PHT always
  // fall inside one UTC date, so UTC prefix filtering is exact. Today and
  // History live on their own pages (/today, /history) now.
  const today = useMemo(() => utcToday(), []);
  const queryClient = useQueryClient();

  // Finalized-tab settlement toggle. Marking paid closes the tab (a paid
  // order is fully done); marking unpaid refreshes the tab sale in place
  // so its lines stay editable via Edit.
  async function togglePaidTab(orderKey: string, saleId: number, paid: 0 | 1) {
    if (detailBusy) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const updated = await patchSalePaid(saleId, paid);
      if (paid === 1) {
        closeOrder(orderKey);
        setError("");
      } else {
        updateSale(orderKey, updated);
      }
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Mark paid failed.");
    } finally {
      setDetailBusy(false);
    }
  }

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });
  const itemsQuery = useQuery({
    queryKey: ["menu-items", "active"],
    queryFn: fetchActiveMenuItems,
  });

  const items = useMemo(
    () => (itemsQuery.data ?? []).filter((item) => item.active === 1),
    [itemsQuery.data],
  );
  const categories = useMemo(
    () => sortCategories(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const visible =
    activeCategory === "all"
      ? items
      : items.filter((item) => item.category_id === activeCategory);
  const totalCents = cartTotalCents(active.lines, items);
  // Locked receipt for a finalized tab (null while the order is open).
  const doneSale = active.status === "done" ? active.sale : null;

  function switchTab(key: string) {
    setActive(key);
    setPromptItem(null);
    setError("");
  }

  function newTab() {
    // Wire discardEmpty explicitly: an empty-and-unposted active tab is
    // replaced rather than stacked (addOrder's internal reap stays as
    // backstop for any other empty temps).
    const state = useOrders.getState();
    const current = state.orders.find((order) => order.key === state.activeKey);
    if (current && current.lines.length === 0 && current.sale === null) {
      state.discardEmpty(current.key);
    }
    addOrder();
    setPromptItem(null);
    setError("");
  }

  async function checkout() {
    // Read fresh state: only an open order Dones. A reopened order (sale
    // kept) re-locks via PUT lines; a fresh order posts once via POST.
    // A locked (done) tab never posts again.
    const order = useOrders.getState().orders.find((o) => o.key === active.key);
    if (!order || order.status !== "open" || order.lines.length === 0) return;
    if (checkoutBusy.current) return;
    checkoutBusy.current = true;
    // Done supersedes any pending variant prompt (its tap was abandoned).
    setPromptItem(null);
    setPending(true);
    setError("");
    try {
      if (order.sale?.id) {
        const updated = await putSaleItems(
          order.sale.id,
          order.lines.map((line) => ({
            menu_item_id: line.menu_item_id,
            qty: line.qty,
            variant: line.variant,
          })),
        );
        completeOrder(order.key, updated);
      } else {
        const completed = await postSale(
          order.payment,
          order.lines.map((line) => ({
            menu_item_id: line.menu_item_id,
            qty: line.qty,
            variant: line.variant,
          })),
        );
        completeOrder(order.key, completed);
      }
      // A fresh sale belongs to today's panel — refresh summary + list.
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
    } finally {
      checkoutBusy.current = false;
      setPending(false);
    }
  }

  function editOrder() {
    reopenForEdit(active.key);
    setError("");
  }

  function deleteOrder() {
    // Local-only: the sale itself is append-only and stays in history.
    closeOrder(active.key);
    setPromptItem(null);
    setError("");
  }

  const isLoading = categoriesQuery.isLoading || itemsQuery.isLoading;
  const isError = categoriesQuery.isError || itemsQuery.isError;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="flex min-h-screen">
        {/* Order rail: New order first, then vertical tabs, zero close buttons. */}
        <div className="flex w-36 shrink-0 flex-col gap-2 border-r border-ink/10 bg-white p-3">
          <h2 className="text-xs font-semibold tracking-widest text-muted">ORDERS</h2>
          <button
            type="button"
            onClick={newTab}
            className="border border-dashed border-ink px-3 py-2 text-sm font-semibold"
          >
            New order
          </button>
          <div role="tablist" aria-label="Orders" className="flex flex-col gap-2">
            {orders.map((order) => {
              const count = order.lines.reduce((sum, line) => sum + line.qty, 0);
              const selected = order.key === active.key;
              return (
                <button
                  key={order.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => switchTab(order.key)}
                  className={
                    selected
                      ? "bg-accent px-3 py-2 text-sm font-semibold text-paper"
                      : "border border-ink px-3 py-2 text-sm font-semibold"
                  }
                >
                  {order.label} ({count})
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-8 px-6 py-12">
          <header className="flex flex-col gap-3">
            <p className="label text-xs text-muted">Cafe &middot; LAN</p>
            <h1 className="text-4xl font-semibold">POS</h1>
            <p className="text-sm text-muted">Tap to add, checkout with cash or GCash.</p>
          </header>
        {isLoading ? (
          <p aria-busy="true" aria-label="Loading menu" className="py-16 text-center text-muted">
            Loading menu…
          </p>
        ) : isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load the menu.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void categoriesQuery.refetch();
                void itemsQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
          <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
            <section aria-label="Menu items" className="flex flex-col gap-6">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Category filter">
                <button
                  type="button"
                  aria-pressed={activeCategory === "all"}
                  onClick={() => setActiveCategory("all")}
                  className={
                    activeCategory === "all"
                      ? "bg-ink px-4 py-2 text-sm font-semibold text-paper"
                      : "border border-ink px-4 py-2 text-sm font-semibold"
                  }
                >
                  All
                </button>
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={activeCategory === category.id}
                    onClick={() => setActiveCategory(category.id)}
                    className={
                      activeCategory === category.id
                        ? "bg-ink px-4 py-2 text-sm font-semibold text-paper"
                        : "border border-ink px-4 py-2 text-sm font-semibold"
                    }
                  >
                    {category.name}
                  </button>
                ))}
              </div>
              {visible.length === 0 ? (
                <p className="py-16 text-center text-muted">No items available</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {visible.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (active.status !== "open") return;
                          if (item.variants.length > 0) {
                            setPromptItem(item);
                          } else {
                            addItem(active.key, item.id);
                          }
                        }}
                        className="flex h-full w-full flex-col items-start gap-1 border border-ink px-4 py-3 text-left"
                      >
                        <span className="text-base font-semibold">{item.name}</span>
                        <span className="text-base text-accent">{formatPeso(item.price_cents)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Cart" className="flex flex-col gap-6">
              <h2 className="text-2xl font-semibold">Order &middot; {today}</h2>
              {doneSale ? (
                <div className="flex flex-col gap-3 border border-ink p-6">
                  <p className="text-lg font-semibold">Sale complete</p>
                  <p className="text-lg">{active.label} · Sale #{doneSale.id}</p>
                  <p className="text-sm text-muted">{doneSale.created_at}</p>
                  {doneSale.paid === 1 ? (
                    <span className="text-base font-semibold text-accent">PAID</span>
                  ) : (
                    <span className="text-base font-semibold text-red-600">UNPAID</span>
                  )}
                  <p className="text-lg font-semibold text-accent">
                    {formatPeso(doneSale.total_cents)}
                  </p>
                  <p className="text-lg">{doneSale.payment === "cash" ? "Cash" : "GCash"}</p>
                  <ul className="flex flex-col gap-2">
                    {doneSale.items.map((line) => {
                      const item = byId.get(line.menu_item_id);
                      const name = formatVariantLabel(
                        item?.name ?? `Item #${line.menu_item_id}`,
                        line.variant,
                      );
                      return (
                        <li key={lineKey(line)} className="flex items-baseline justify-between gap-4 border-b border-ink/10 pb-2">
                          <span className="text-base font-semibold">
                            {name} × {line.qty}
                          </span>
                          <span className="text-base text-accent">
                            {formatPeso(line.unit_price_cents * line.qty)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {doneSale.paid === 1 ? (
                    <button
                      type="button"
                      onClick={() => void togglePaidTab(active.key, doneSale.id, 0)}
                      disabled={detailBusy}
                      className="border border-ink px-4 py-3 text-base font-semibold disabled:opacity-40"
                    >
                      Mark unpaid
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void togglePaidTab(active.key, doneSale.id, 1)}
                      disabled={detailBusy}
                      className="bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-40"
                    >
                      Mark paid
                    </button>
                  )}
                  {detailError !== "" ? (
                    <p role="alert" className="text-base">
                      {detailError}
                    </p>
                  ) : null}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={editOrder}
                      disabled={doneSale.paid === 1}
                      className="flex-1 border border-ink px-4 py-3 text-base font-semibold disabled:opacity-40"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={deleteOrder}
                      className="flex-1 border border-red-600 px-4 py-3 text-base font-semibold text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {promptItem !== null ? (
                    <div
                      role="dialog"
                      aria-label={`Choose ${promptItem.name} variant`}
                      className="flex flex-col gap-3 border border-ink p-4"
                    >
                      <p className="text-base font-semibold">
                        {promptItem.name} &middot; choose a variant
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {promptItem.variants.map((variant) => (
                          <button
                            key={variant}
                            type="button"
                            onClick={() => {
                              addItem(active.key, promptItem.id, variant);
                              setPromptItem(null);
                            }}
                            className="border border-ink px-4 py-2 text-sm font-semibold"
                          >
                            {variant}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setPromptItem(null)}
                        className="self-start px-2 py-1 text-sm text-muted underline"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {active.lines.length === 0 ? (
                    <p className="text-muted">Order is empty. Tap an item to add it.</p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {active.lines.map((line) => {
                        const item = byId.get(line.menu_item_id);
                        const name = formatVariantLabel(
                          item?.name ?? `Item #${line.menu_item_id}`,
                          line.variant,
                        );
                        return (
                          <li key={lineKey(line)} className="flex flex-col gap-2 border-b border-ink/10 pb-4">
                            <div className="flex items-baseline justify-between gap-4">
                              <span className="text-base font-semibold">{name}</span>
                              <span className="text-base text-accent">
                                {formatPeso((item?.price_cents ?? 0) * line.qty)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Decrease ${name} quantity`}
                                onClick={() => setQty(active.key, line.menu_item_id, line.variant, line.qty - 1)}
                                className="border border-ink px-3 py-1 text-base font-semibold"
                              >
                                −
                              </button>
                              <span aria-label={`${name} quantity`} className="min-w-8 text-center text-base">
                                {line.qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`Increase ${name} quantity`}
                                onClick={() => setQty(active.key, line.menu_item_id, line.variant, line.qty + 1)}
                                className="border border-ink px-3 py-1 text-base font-semibold"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${name} from cart`}
                                onClick={() => removeLine(active.key, line.menu_item_id, line.variant)}
                                className="ml-auto px-2 py-1 text-sm text-muted underline"
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <p className="text-xl font-semibold">
                    Total <span className="text-accent">{formatPeso(totalCents)}</span>
                  </p>
                  {active.sale ? (
                    <>
                      <p className="text-sm text-muted">
                        Editing {active.label} — payment {active.payment === "cash" ? "Cash" : "GCash"} is fixed. Tap items to stage changes, then Done to save.
                      </p>
                      <p className="text-lg">{active.payment === "cash" ? "Cash" : "GCash"}</p>
                    </>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        aria-pressed={active.payment === "cash"}
                        onClick={() => setPayment(active.key, "cash")}
                        className={methodButton(active.payment === "cash")}
                      >
                        Cash
                      </button>
                      <button
                        type="button"
                        aria-pressed={active.payment === "gcash"}
                        onClick={() => setPayment(active.key, "gcash")}
                        className={methodButton(active.payment === "gcash")}
                      >
                        GCash
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void checkout()}
                    disabled={active.lines.length === 0 || pending}
                    className="bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-40"
                  >
                    {pending ? "Saving…" : "Done"}
                  </button>
                  {error !== "" ? (
                    <div className="flex flex-col items-start gap-2">
                      <p role="alert" className="text-base">
                        {error}
                      </p>
                      <button
                        type="button"
                        onClick={() => void checkout()}
                        className="border border-ink px-4 py-2 text-sm font-semibold"
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </div>
          </>
        )}
        </div>
      </div>
    </main>
  );
}
