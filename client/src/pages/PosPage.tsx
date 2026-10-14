import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchActiveMenuItems, fetchCategories } from "../api/menu";
import { fetchSalesForDate, fetchSummary, patchSaleVoid, postSale, utcToday, type SaleRow } from "../api/sales";
import { formatPeso } from "../lib/formatPeso";
import { cartTotalCents, useOrders } from "../store/orders";
import { sortCategories } from "../lib/sortCategories";

const methodButton = (pressed: boolean) =>
  pressed
    ? "flex-1 bg-ink px-4 py-4 text-lg font-semibold text-paper"
    : "flex-1 border border-ink px-4 py-4 text-lg font-semibold";

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
  const clearOrder = useOrders((s) => s.clearOrder);
  const completeOrder = useOrders((s) => s.completeOrder);

  const active = orders.find((order) => order.key === activeKey) ?? orders[0];

  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [todayError, setTodayError] = useState("");
  // Sync re-entry guard: two clicks before the pending re-render still
  // post only once. The done-status check below blocks any later click.
  const checkoutBusy = useRef(false);

  // UTC-date "Today" panel (Task 8): the day boundary is the UTC calendar
  // date, matching GET /api/sales/summary. Shop hours 2pm-10pm PHT always
  // fall inside one UTC date, so UTC prefix filtering is exact.
  const today = useMemo(() => utcToday(), []);
  const queryClient = useQueryClient();
  const summaryQuery = useQuery({
    queryKey: ["sales", "summary", today],
    queryFn: () => fetchSummary(today),
  });
  const todaySalesQuery = useQuery({
    queryKey: ["sales", "today", today],
    queryFn: () => fetchSalesForDate(today),
  });

  async function toggleVoid(row: SaleRow) {
    setTodayError("");
    try {
      await patchSaleVoid(row.id, row.voided === 1 ? 0 : 1);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setTodayError(err instanceof Error ? err.message : "Void failed.");
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

  function switchTab(key: string) {
    setActive(key);
    setError("");
  }

  function newTab() {
    addOrder();
    setError("");
  }

  function closeTab(key: string) {
    closeOrder(key);
    setError("");
  }

  async function checkout() {
    // Read fresh state: only the active order posts, and a locked
    // (done) tab never posts again.
    const order = useOrders.getState().orders.find((o) => o.key === active.key);
    if (!order || order.status === "done" || order.lines.length === 0) return;
    if (checkoutBusy.current) return;
    checkoutBusy.current = true;
    setPending(true);
    setError("");
    try {
      const completed = await postSale(
        order.payment,
        order.lines.map((line) => ({ menu_item_id: line.menu_item_id, qty: line.qty })),
      );
      completeOrder(order.key, completed);
      // A fresh sale belongs to today's panel — refresh summary + list.
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
    } finally {
      checkoutBusy.current = false;
      setPending(false);
    }
  }

  function newSale() {
    clearOrder(active.key);
    setError("");
  }

  const isLoading = categoriesQuery.isLoading || itemsQuery.isLoading;
  const isError = categoriesQuery.isError || itemsQuery.isError;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
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
          <div role="tablist" aria-label="Orders" className="flex flex-wrap items-center gap-2">
            {orders.map((order) => {
              const count = order.lines.reduce((sum, line) => sum + line.qty, 0);
              const selected = order.key === active.key;
              return (
                <span key={order.key} className="flex items-stretch">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => switchTab(order.key)}
                    className={
                      selected
                        ? "bg-ink px-4 py-2 text-sm font-semibold text-paper"
                        : "border border-ink px-4 py-2 text-sm font-semibold"
                    }
                  >
                    {order.label} ({count})
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${order.label}`}
                    onClick={() => closeTab(order.key)}
                    className="border border-ink border-l-0 px-2 py-2 text-sm font-semibold text-muted"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={newTab}
              className="border border-dashed border-ink px-4 py-2 text-sm font-semibold"
            >
              New order
            </button>
          </div>
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
                          if (active.status === "open") addItem(active.key, item.id);
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
              {active.status === "done" && active.sale ? (
                <div className="flex flex-col gap-3 border border-ink p-6">
                  <h2 className="text-2xl font-semibold">Sale complete</h2>
                  <p className="text-lg">Sale #{active.sale.id}</p>
                  <p className="text-lg font-semibold text-accent">
                    {formatPeso(active.sale.total_cents)}
                  </p>
                  <p className="text-lg">{active.sale.payment === "cash" ? "Cash" : "GCash"}</p>
                  <button
                    type="button"
                    onClick={newSale}
                    className="mt-2 bg-ink px-4 py-3 text-base font-semibold text-paper"
                  >
                    New sale
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold">Cart</h2>
                  {active.lines.length === 0 ? (
                    <p className="text-muted">Cart is empty. Tap an item to add it.</p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {active.lines.map((line) => {
                        const item = byId.get(line.menu_item_id);
                        const name = item?.name ?? `Item #${line.menu_item_id}`;
                        return (
                          <li key={line.menu_item_id} className="flex flex-col gap-2 border-b border-ink/10 pb-4">
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
                                onClick={() => setQty(active.key, line.menu_item_id, line.qty - 1)}
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
                                onClick={() => setQty(active.key, line.menu_item_id, line.qty + 1)}
                                className="border border-ink px-3 py-1 text-base font-semibold"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${name} from cart`}
                                onClick={() => removeLine(active.key, line.menu_item_id)}
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
                  <button
                    type="button"
                    onClick={() => void checkout()}
                    disabled={active.lines.length === 0 || pending}
                    className="bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-40"
                  >
                    {pending ? "Checking out…" : "Checkout"}
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
          <section aria-label="Today" className="flex flex-col gap-4 border border-ink p-6">
            <h2 className="text-2xl font-semibold">Today</h2>
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
                  : ""}
              </p>
            ) : summaryQuery.isLoading ? (
              <p className="text-muted">Loading today&apos;s summary…</p>
            ) : (
              <p className="text-muted">Could not load today&apos;s summary.</p>
            )}
            {todayError !== "" ? (
              <p role="alert" className="text-base">
                {todayError}
              </p>
            ) : null}
            {todaySalesQuery.data ? (
              todaySalesQuery.data.length === 0 ? (
                <p className="text-muted">No sales yet today.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {todaySalesQuery.data.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 pb-2"
                    >
                      <span className="font-semibold">Sale #{row.id}</span>
                      <span className="text-muted">{row.created_at.slice(11, 16)}</span>
                      <span>{row.payment === "cash" ? "Cash" : "GCash"}</span>
                      <span className="text-accent">{formatPeso(row.total_cents)}</span>
                      {row.voided === 1 ? <span>Voided</span> : null}
                      <button
                        type="button"
                        aria-label={
                          row.voided === 1 ? `Unvoid sale ${row.id}` : `Void sale ${row.id}`
                        }
                        onClick={() => void toggleVoid(row)}
                        className="ml-auto border border-ink px-3 py-1 text-sm font-semibold"
                      >
                        {row.voided === 1 ? "Unvoid" : "Void"}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : todaySalesQuery.isLoading ? (
              <p className="text-muted">Loading today&apos;s sales…</p>
            ) : (
              <p className="text-muted">Could not load today&apos;s sales.</p>
            )}
          </section>
          </>
        )}
      </div>
    </main>
  );
}
