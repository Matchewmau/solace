/**
 * POS multi-order state (Zustand).
 *
 * One tab per order: each order holds its own lines + payment. Order
 * labels are UI-only and in-memory-only — never posted to /api/sales,
 * never shown in the Today panel, lost on reload.
 *
 * Checkout payload stays exactly {payment, items} — order lines hold
 * only menu_item_id + qty.
 */
import { create } from "zustand";
import type { MenuItem } from "../api/menu";
import type { PaymentMethod, Sale } from "../api/sales";

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
}

interface OrdersState {
  orders: Order[];
  activeKey: string;
  nextNumber: number;
  addOrder: () => void;
  closeOrder: (key: string) => void;
  setActive: (key: string) => void;
  addItem: (key: string, menuItemId: number) => void;
  setQty: (key: string, menuItemId: number, qty: number) => void;
  removeLine: (key: string, menuItemId: number) => void;
  setPayment: (key: string, payment: PaymentMethod) => void;
  clearOrder: (key: string) => void;
}

function createOrder(number: number): Order {
  return {
    key: `order-${number}`,
    label: `Order #${number}`,
    lines: [],
    payment: "cash",
    status: "open",
    sale: null,
  };
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

export const useOrders = create<OrdersState>()((set) => ({
  orders: [createOrder(1)],
  activeKey: "order-1",
  nextNumber: 2,
  addOrder: () =>
    set((state) => {
      const order = createOrder(state.nextNumber);
      return {
        orders: [...state.orders, order],
        activeKey: order.key,
        nextNumber: state.nextNumber + 1,
      };
    }),
  closeOrder: (key) =>
    set((state) => {
      const remaining = state.orders.filter((order) => order.key !== key);
      if (remaining.length === 0) {
        const fresh = createOrder(state.nextNumber);
        return {
          orders: [fresh],
          activeKey: fresh.key,
          nextNumber: state.nextNumber + 1,
        };
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
      orders: editOrder(state.orders, key, (order) => ({
        ...order,
        lines: updateLines(order.lines, menuItemId, (qty) => (qty ?? 0) + 1),
      })),
    })),
  setQty: (key, menuItemId, qty) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => ({
        ...order,
        lines: updateLines(order.lines, menuItemId, () =>
          !Number.isInteger(qty) || qty < 1 ? undefined : qty,
        ),
      })),
    })),
  removeLine: (key, menuItemId) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => ({
        ...order,
        lines: order.lines.filter((line) => line.menu_item_id !== menuItemId),
      })),
    })),
  setPayment: (key, payment) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => ({ ...order, payment })),
    })),
  clearOrder: (key) =>
    set((state) => ({
      orders: editOrder(state.orders, key, (order) => ({
        ...order,
        lines: [],
        payment: "cash",
        status: "open",
        sale: null,
      })),
    })),
}));

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
