import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchActiveMenuItems, fetchCategories } from "../api/menu";
import { fetchPastSales, fetchSalesForDate, fetchSummary, patchSalePaid, patchSaleVoid, postSale, putSaleItems, utcToday, type Sale, type SaleItemPayload, type SaleRow } from "../api/sales";
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
  const updateSale = useOrders((s) => s.updateSale);

  const active = orders.find((order) => order.key === activeKey) ?? orders[0];

  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [todayError, setTodayError] = useState("");
  // Finalized-tab ops (PUT items, Mark paid/unpaid) share one busy flag +
  // one error line so overlapping detail writes cannot interleave.
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
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
  const historyQuery = useQuery({
    queryKey: ["sales", "history", today],
    queryFn: () => fetchPastSales(today),
  });

  // Today splits by settlement: anything not paid-1 reads as unpaid (the
  // safer default — an unknown flag must demand attention, not hide).
  const todayRows = todaySalesQuery.data ?? [];
  const unpaidToday = todayRows.filter((row) => row.paid !== 1);
  const paidToday = todayRows.filter((row) => row.paid === 1);
  const paidTodayTotal = paidToday
    .filter((row) => row.voided !== 1)
    .reduce((sum, row) => sum + row.total_cents, 0);

  async function toggleVoid(row: SaleRow) {
    setTodayError("");
    try {
      await patchSaleVoid(row.id, row.voided === 1 ? 0 : 1);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setTodayError(err instanceof Error ? err.message : "Void failed.");
    }
  }

  async function togglePaidRow(row: SaleRow) {
    setTodayError("");
    try {
      await patchSalePaid(row.id, row.paid === 1 ? 0 : 1);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setTodayError(err instanceof Error ? err.message : "Mark paid failed.");
    }
  }

  // Finalized-tab settlement toggle. Marking paid closes the tab (a paid
  // order is fully done); marking unpaid refreshes the tab sale in place
  // so its lines stay editable.
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

  // Finalized-but-unpaid line edit: re-PUT the sale lines, refresh the tab
  // sale from the server response, and refresh every ["sales"] panel.
  async function changeSaleQty(sale: Sale, orderKey: string, menuItemId: number, delta: number) {
    if (detailBusy) return;
    const current = sale.items.find((line) => line.menu_item_id === menuItemId);
    if (!current) return;
    const next: SaleItemPayload[] = [];
    for (const line of sale.items) {
      const qty = line.qty + (line.menu_item_id === menuItemId ? delta : 0);
      if (qty >= 1) next.push({ menu_item_id: line.menu_item_id, qty });
    }
    // The server rejects empty item lists — a sale cannot be edited down
    // to zero lines (void it or start a New sale instead).
    if (next.length === 0) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const updated = await putSaleItems(sale.id, next);
      updateSale(orderKey, updated);
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Edit failed.");
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

  // One today-list row. Unpaid rows read red and carry a Mark paid button;
  // paid rows carry Mark unpaid. Both are aria-labeled per sale so they
  // never collide with the tab's Mark paid / Mark unpaid buttons.
  // void/unvoid stays on every today row, paid or not.
  function todayRow(row: SaleRow, markPaid: boolean) {
    return (
      <li
        key={row.id}
        className={
          row.paid === 1
            ? "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 pb-2"
            : "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 pb-2 text-red-600"
        }
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
        {row.paid === 1 ? (
          <button
            type="button"
            aria-label={`Mark sale ${row.id} unpaid`}
            onClick={() => void togglePaidRow(row)}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Mark unpaid
          </button>
        ) : markPaid ? (
          <button
            type="button"
            aria-label={`Mark sale ${row.id} paid`}
            onClick={() => void togglePaidRow(row)}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Mark paid
          </button>
        ) : null}
      </li>
    );
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
              <h2 className="text-2xl font-semibold">Order &middot; {today}</h2>
              {doneSale ? (
                <div className="flex flex-col gap-3 border border-ink p-6">
                  <p className="text-lg font-semibold">Sale complete</p>
                  <p className="text-lg">Sale #{doneSale.id}</p>
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
                  {doneSale.paid === 1 ? null : (
                    <ul className="flex flex-col gap-4">
                      {doneSale.items.map((line) => {
                        const item = byId.get(line.menu_item_id);
                        const name = item?.name ?? `Item #${line.menu_item_id}`;
                        return (
                          <li key={line.menu_item_id} className="flex flex-col gap-2 border-b border-ink/10 pb-4">
                            <div className="flex items-baseline justify-between gap-4">
                              <span className="text-base font-semibold">{name}</span>
                              <span className="text-base text-accent">
                                {formatPeso(line.unit_price_cents * line.qty)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Decrease ${name} quantity`}
                                onClick={() => void changeSaleQty(doneSale, active.key, line.menu_item_id, -1)}
                                disabled={detailBusy}
                                className="border border-ink px-3 py-1 text-base font-semibold disabled:opacity-40"
                              >
                                −
                              </button>
                              <span aria-label={`${name} quantity`} className="min-w-8 text-center text-base">
                                {line.qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`Increase ${name} quantity`}
                                onClick={() => void changeSaleQty(doneSale, active.key, line.menu_item_id, 1)}
                                disabled={detailBusy}
                                className="border border-ink px-3 py-1 text-base font-semibold disabled:opacity-40"
                              >
                                +
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
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
                  <button
                    type="button"
                    onClick={newSale}
                    className="mt-2 border border-ink px-4 py-3 text-base font-semibold"
                  >
                    New sale
                  </button>
                </div>
              ) : (
                <>
                  {active.lines.length === 0 ? (
                    <p className="text-muted">Order is empty. Tap an item to add it.</p>
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
                    {pending ? "Finalizing…" : "Finalize"}
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
              <>
                <h3 className="text-xl font-semibold">Unpaid</h3>
                {unpaidToday.length === 0 ? (
                  <p className="text-muted">No unpaid sales.</p>
                ) : (
                  <ul aria-label="Unpaid sales" className="flex flex-col gap-2">
                    {unpaidToday.map((row) => todayRow(row, true))}
                  </ul>
                )}
                <h3 className="text-xl font-semibold">Paid today</h3>
                {paidToday.length === 0 ? (
                  <p className="text-muted">No paid sales yet.</p>
                ) : (
                  <>
                    <ul aria-label="Paid today sales" className="flex flex-col gap-2">
                      {paidToday.map((row) => todayRow(row, false))}
                    </ul>
                    <p className="text-lg">
                      Paid total{" "}
                      <span className="font-semibold text-accent">
                        {formatPeso(paidTodayTotal)}
                      </span>
                    </p>
                  </>
                )}
              </>
            ) : todaySalesQuery.isLoading ? (
              <p className="text-muted">Loading today&apos;s sales…</p>
            ) : (
              <p className="text-muted">Could not load today&apos;s sales.</p>
            )}
            <h3 className="text-xl font-semibold">History</h3>
            {historyQuery.data ? (
              historyQuery.data.length === 0 ? (
                <p className="text-muted">No past sales.</p>
              ) : (
                <ul aria-label="History sales" className="flex flex-col gap-2">
                  {historyQuery.data.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/10 pb-2"
                    >
                      <span className="font-semibold">Sale #{row.id}</span>
                      <span className="text-muted">{row.created_at.slice(0, 10)}</span>
                      <span>{row.payment === "cash" ? "Cash" : "GCash"}</span>
                      <span className="text-accent">{formatPeso(row.total_cents)}</span>
                      {row.voided === 1 ? <span>Voided</span> : null}
                    </li>
                  ))}
                </ul>
              )
            ) : historyQuery.isLoading ? (
              <p className="text-muted">Loading past sales…</p>
            ) : (
              <p className="text-muted">Could not load past sales.</p>
            )}
          </section>
          </>
        )}
      </div>
    </main>
  );
}
