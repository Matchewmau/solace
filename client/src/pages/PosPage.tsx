import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchActiveMenuItems, fetchCategories } from "../api/menu";
import { postSale, type PaymentMethod, type Sale } from "../api/sales";
import { formatPeso } from "../lib/formatPeso";
import { cartTotalCents, useCart } from "../store/cart";
import { sortCategories } from "./MenuPage";

type CheckoutStatus = "idle" | "pending" | "success" | "error";

const methodButton = (pressed: boolean) =>
  pressed
    ? "flex-1 bg-ink px-4 py-4 text-lg font-semibold text-paper"
    : "flex-1 border border-ink px-4 py-4 text-lg font-semibold";

export default function PosPage() {
  const lines = useCart((s) => s.lines);
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);

  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [status, setStatus] = useState<CheckoutStatus>("idle");
  const [sale, setSale] = useState<Sale | null>(null);
  const [error, setError] = useState("");

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
  const totalCents = cartTotalCents(lines, items);

  async function checkout() {
    if (lines.length === 0) return;
    setStatus("pending");
    setError("");
    try {
      const completed = await postSale(
        payment,
        lines.map((line) => ({ menu_item_id: line.menu_item_id, qty: line.qty })),
      );
      setSale(completed);
      setStatus("success");
      clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setStatus("error");
    }
  }

  function newSale() {
    setSale(null);
    setError("");
    setStatus("idle");
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
                        onClick={() => add(item.id)}
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
              {status === "success" && sale ? (
                <div className="flex flex-col gap-3 border border-ink p-6">
                  <h2 className="text-2xl font-semibold">Sale complete</h2>
                  <p className="text-lg">Sale #{sale.id}</p>
                  <p className="text-lg font-semibold text-accent">
                    {formatPeso(sale.total_cents)}
                  </p>
                  <p className="text-lg">{sale.payment === "cash" ? "Cash" : "GCash"}</p>
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
                  {lines.length === 0 ? (
                    <p className="text-muted">Cart is empty. Tap an item to add it.</p>
                  ) : (
                    <ul className="flex flex-col gap-4">
                      {lines.map((line) => {
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
                                onClick={() => setQty(line.menu_item_id, line.qty - 1)}
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
                                onClick={() => setQty(line.menu_item_id, line.qty + 1)}
                                className="border border-ink px-3 py-1 text-base font-semibold"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${name} from cart`}
                                onClick={() => remove(line.menu_item_id)}
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
                      aria-pressed={payment === "cash"}
                      onClick={() => setPayment("cash")}
                      className={methodButton(payment === "cash")}
                    >
                      Cash
                    </button>
                    <button
                      type="button"
                      aria-pressed={payment === "gcash"}
                      onClick={() => setPayment("gcash")}
                      className={methodButton(payment === "gcash")}
                    >
                      GCash
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void checkout()}
                    disabled={lines.length === 0 || status === "pending"}
                    className="bg-ink px-4 py-3 text-base font-semibold text-paper disabled:opacity-40"
                  >
                    {status === "pending" ? "Checking out…" : "Checkout"}
                  </button>
                  {status === "error" ? (
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
        )}
      </div>
    </main>
  );
}
