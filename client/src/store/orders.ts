/**
 * POS multi-order state (Zustand).
 *
 * Open rail tabs carry temporary local labels (`Order #<tempNo>`) that are
 * never posted to /api/sales. Pressing Done POSTs once and binds the tab to
 * its database daily number (`Order #<daily_seq>`, allocated per UTC date
 * inside the sale transaction) plus the returned sale.
 *
 * Tabs persist to localStorage with the UTC date. A stored date older than
 * today starts a fresh day (single empty temp); empty temps (no lines, no
 * sale) are reaped on load and whenever a new order is added, so mistaken
 * empties never POST and never accumulate.
 *
 * Checkout payload stays exactly {payment, items, paid} — order lines hold
 * only menu_item_id + qty. completeOrder is the single open→done
 * transition (binds dailySeq + label); it never overwrites a done order.
 * updateSale refreshes the locked receipt after unpaid edits (PUT items)
 * or Mark unpaid (PATCH paid) — paid-off never reopens the tab.
 * reopenForEdit flips a done-but-unpaid tab back to open (sale kept for
 * the re-Done PUT); discardEmpty drops a never-posted empty tab locally.
 */
import { create } from "zustand";
import type { MenuItem } from "../api/menu";
import { utcToday, type PaymentMethod, type Sale } from "../api/sales";

export interface OrderLine {
  menu_item_id: number;
  qty: number;
}

export type OrderStatus = "open" | "done";

export interface Order {
  key: string;
  label: string;
  lines: OrderLine[];
  payment: PaymentMethod;
  status: OrderStatus;
  sale: Sale | null;
  /** Daily number bound at Done from sale.daily_seq; null while temporary. */
  dailySeq: number | null;
  /** Local temp number used for the open label only. */
  tempNo: number;
}

interface OrdersState {
  orders: Order[];
  activeKey: string;
  addOrder: () => void;
  closeOrder: (key: string) => void;
  setActive: (key: string) => void;
  addItem: (key: string, menuItemId: number) => void;
  setQty: (key: string, menuItemId: number, qty: number) => void;
  removeLine: (key: string, menuItemId: number) => void;
  setPayment: (key: string, payment: PaymentMethod) => void;
  clearOrder: (key: string) => void;
  completeOrder: (key: string, sale: Sale) => void;
  updateSale: (key: string, sale: Sale) => void;
  reopenForEdit: (key: string) => void;
  discardEmpty: (key: string) => void;
}

/** localStorage key for the persisted {orders, activeKey, utcDate} snapshot. */
export const ORDERS_STORAGE_KEY = "solace:orders:v1";

function createTempOrder(tempNo: number): Order {
  return {
    key: `order-${tempNo}`,
    label: `Order #${tempNo}`,
    lines: [],
    payment: "cash",
    status: "open",
    sale: null,
    dailySeq: null,
    tempNo,
  };
}

/**
 * Next temp number skips temp and bound numbers already in use, so a new
 * open tab never duplicates a visible bound label (Done daily 2, then New
 * order must not mint temp 2). No monotonic counter to persist.
 */
function nextTempNo(orders: Order[]): number {
  return (
    orders.reduce(
      (max, order) => Math.max(max, order.tempNo, order.dailySeq ?? 0),
      0,
    ) + 1
  );
}

/** Never-posted empty tab: no lines and no sale. Never POSTed, safe to reap. */
function isEmptyTemp(order: Order): boolean {
  return order.lines.length === 0 && order.sale === null;
}

function updateLines(
  lines: OrderLine[],
  menuItemId: number,
  apply: (qty: number | undefined) => number | undefined,
): OrderLine[] {
  const existing = lines.find((line) => line.menu_item_id === menuItemId);
  const nextQty = apply(existing?.qty);
  if (nextQty === undefined) {
    return lines.filter((line) => line.menu_item_id !== menuItemId);
  }
  if (!existing) {
    return [...lines, { menu_item_id: menuItemId, qty: nextQty }];
  }
  return lines.map((line) =>
    line.menu_item_id === menuItemId ? { ...line, qty: nextQty } : line,
  );
}

function editOrder(
  orders: Order[],
  key: string,
  edit: (order: Order) => Order,
): Order[] {
  return orders.map((order) => (order.key === key ? edit(order) : order));
}

function sanitizeOrder(raw: unknown): Order | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.key !== "string" || source.key === "") return null;
  if (typeof source.tempNo !== "number" || !Number.isInteger(source.tempNo)) {
    return null;
  }
  const lines = Array.isArray(source.lines)
    ? source.lines.flatMap((line) => {
        if (typeof line !== "object" || line === null) return [];
        const entry = line as Record<string, unknown>;
        if (
          typeof entry.menu_item_id !== "number" ||
          typeof entry.qty !== "number" ||
          !Number.isInteger(entry.qty) ||
          entry.qty < 1
        ) {
          return [];
        }
        return [{ menu_item_id: entry.menu_item_id, qty: entry.qty }];
      })
    : [];
  const sale =
    typeof source.sale === "object" && source.sale !== null
      ? (source.sale as Sale)
      : null;
  const status: OrderStatus =
    source.status === "done" && sale !== null ? "done" : "open";
  const dailySeq =
    typeof source.dailySeq === "number" && Number.isInteger(source.dailySeq)
      ? source.dailySeq
      : null;
  // Labels are fully derived (Order #<dailySeq|tempNo>); recompute so a
  // stale or tampered stored label can never disagree with the numbers.
  const label = `Order #${dailySeq ?? source.tempNo}`;
  return {
    key: source.key,
    label,
    lines,
    payment: source.payment === "gcash" ? "gcash" : "cash",
    status,
    sale,
    dailySeq,
    tempNo: source.tempNo,
  };
}

/**
 * Parse a stored snapshot. Returns null when there is nothing usable:
 * missing/corrupt JSON, wrong version, a stale UTC date (fresh day starts
 * over), or no surviving tabs after reaping empty temps.
 */
export function loadOrdersSnapshot(
  raw: string | null,
  today: string,
): { orders: Order[]; activeKey: string } | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const snapshot = parsed as Record<string, unknown>;
  if (snapshot.version !== 1 || typeof snapshot.utcDate !== "string") {
    return null;
  }
  if (snapshot.utcDate !== today) return null;
  if (!Array.isArray(snapshot.orders) || typeof snapshot.activeKey !== "string") {
    return null;
  }
  const kept = snapshot.orders
    .map(sanitizeOrder)
    .filter((order): order is Order => order !== null)
    .filter((order) => !isEmptyTemp(order));
  if (kept.length === 0) return null;
  return {
    orders: kept,
    activeKey: kept.some((order) => order.key === snapshot.activeKey)
      ? (snapshot.activeKey as string)
      : kept[kept.length - 1].key,
  };
}

function readStoredSnapshot(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(ORDERS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistSnapshot(state: {
  orders: Order[];
  activeKey: string;
}): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      ORDERS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        utcDate: utcToday(),
        orders: state.orders,
        activeKey: state.activeKey,
      }),
    );
  } catch {
    // Storage full or blocked — the POS keeps running in memory.
  }
}

function defaultOrdersState(): { orders: Order[]; activeKey: string } {
  const fresh = createTempOrder(1);
  return { orders: [fresh], activeKey: fresh.key };
}

const initial =
  loadOrdersSnapshot(readStoredSnapshot(), utcToday()) ?? defaultOrdersState();

export const useOrders = create<OrdersState>()((set) => ({
  orders: initial.orders,
  activeKey: initial.activeKey,
  addOrder: () =>
    set((state) => {
      const kept = state.orders.filter((order) => !isEmptyTemp(order));
      const order = createTempOrder(nextTempNo(kept));
      return { orders: [...kept, order], activeKey: order.key };
    }),
  closeOrder: (key) =>
    set((state) => {
      const remaining = state.orders.filter((order) => order.key !== key);
      if (remaining.length === 0) {
        const fresh = createTempOrder(nextTempNo(remaining));
        return { orders: [fresh], activeKey: fresh.key };
      }
      return {
        orders: remaining,
        activeKey:
          state.activeKey === key
            ? remaining[remaining.length - 1].key
            : state.activeKey,
      };
    }),
  setActive: (key) =>
    set((state) =>
      state.orders.some((order) => order.key === key)
        ? { activeKey: key }
        : {},
    ),
  addItem: (key, menuItemId) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => {
        if (order.status !== "open") return order;
        return {
          ...order,
          lines: updateLines(order.lines, menuItemId, (qty) => (qty ?? 0) + 1),
        };
      }),
    })),
  setQty: (key, menuItemId, qty) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => {
        if (order.status !== "open") return order;
        return {
          ...order,
          lines: updateLines(order.lines, menuItemId, () =>
            !Number.isInteger(qty) || qty < 1 ? undefined : qty,
          ),
        };
      }),
    })),
  removeLine: (key, menuItemId) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => {
        if (order.status !== "open") return order;
        return {
          ...order,
          lines: order.lines.filter((line) => line.menu_item_id !== menuItemId),
        };
      }),
    })),
  setPayment: (key, payment) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) =>
        order.status !== "open" ? order : { ...order, payment },
      ),
    })),
  clearOrder: (key) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => ({
        ...order,
        lines: [],
        payment: "cash",
        status: "open",
        sale: null,
        dailySeq: null,
        label: `Order #${order.tempNo}`,
      })),
    })),
  completeOrder: (key, sale) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => {
        if (order.status !== "open") return order;
        const seq = sale.daily_seq;
        if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
          return order;
        }
        return {
          ...order,
          status: "done",
          sale,
          dailySeq: seq,
          label: `Order #${seq}`,
        };
      }),
    })),
  updateSale: (key, sale) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) =>
        order.status === "done" ? { ...order, sale } : order,
      ),
    })),
  reopenForEdit: (key) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) =>
        order.status === "done" &&
        order.sale !== null &&
        order.sale.paid !== 1
          ? { ...order, status: "open" }
          : order,
      ),
    })),
  discardEmpty: (key) =>
    set((state) => {
      const target = state.orders.find((order) => order.key === key);
      if (!target || !isEmptyTemp(target)) return state;
      const remaining = state.orders.filter((order) => order.key !== key);
      if (remaining.length === 0) {
        const fresh = createTempOrder(nextTempNo(remaining));
        return { orders: [fresh], activeKey: fresh.key };
      }
      return {
        orders: remaining,
        activeKey:
          state.activeKey === key
            ? remaining[remaining.length - 1].key
            : state.activeKey,
      };
    }),
}));

// Persist every change (orders + activeKey + UTC date) for refresh safety.
useOrders.subscribe((state) => {
  persistSnapshot(state);
});

/**
 * Client-side order total from menu prices (display estimate only —
 * the binding total is computed server-side on POST /api/sales).
 */
export function cartTotalCents(
  lines: OrderLine[],
  items: MenuItem[],
): number {
  const prices = new Map(items.map((item) => [item.id, item.price_cents]));
  return lines.reduce(
    (sum, line) => sum + (prices.get(line.menu_item_id) ?? 0) * line.qty,
    0,
  );
}
