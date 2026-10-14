import { beforeEach, describe, expect, it } from "vitest";
import { cartTotalCents, useOrders } from "./orders";
import type { MenuItem } from "../api/menu";

function resetOrders() {
  useOrders.setState({
    orders: [
      {
        key: "order-1",
        label: "Order #1",
        lines: [],
        payment: "cash",
        status: "open",
        sale: null,
      },
    ],
    activeKey: "order-1",
    nextNumber: 2,
  });
}

beforeEach(() => {
  resetOrders();
});

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1 },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1 },
];

function order(key: string) {
  const found = useOrders.getState().orders.find((o) => o.key === key);
  if (!found) throw new Error(`missing order ${key}`);
  return found;
}

describe("orders store", () => {
  it("starts with one order (Order #1)", () => {
    const state = useOrders.getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      key: "order-1",
      label: "Order #1",
      lines: [],
      payment: "cash",
      status: "open",
      sale: null,
    });
    expect(state.activeKey).toBe("order-1");
    expect(state.nextNumber).toBe(2);
  });

  it("holds different lines and payments per order independently", () => {
    const state = useOrders.getState();
    state.addOrder();
    const second = useOrders.getState().activeKey;

    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().setPayment("order-1", "cash");
    useOrders.getState().addItem(second, 2);
    useOrders.getState().setPayment(second, "gcash");

    expect(order("order-1").lines).toEqual([{ menu_item_id: 1, qty: 2 }]);
    expect(order("order-1").payment).toBe("cash");
    expect(order(second).lines).toEqual([{ menu_item_id: 2, qty: 1 }]);
    expect(order(second).payment).toBe("gcash");
  });

  it("adds, switches, and closes orders", () => {
    useOrders.getState().addOrder();
    expect(useOrders.getState().orders.map((o) => o.label)).toEqual([
      "Order #1",
      "Order #2",
    ]);
    expect(useOrders.getState().activeKey).toBe("order-2");

    useOrders.getState().setActive("order-1");
    expect(useOrders.getState().activeKey).toBe("order-1");

    useOrders.getState().closeOrder("order-2");
    expect(useOrders.getState().orders.map((o) => o.key)).toEqual(["order-1"]);
    expect(useOrders.getState().activeKey).toBe("order-1");
  });

  it("falls back to a remaining order when the active order is closed", () => {
    useOrders.getState().addOrder();
    useOrders.getState().addOrder();
    useOrders.getState().setActive("order-2");
    useOrders.getState().closeOrder("order-2");
    expect(useOrders.getState().activeKey).toBe("order-3");
    expect(useOrders.getState().orders.map((o) => o.key)).toEqual([
      "order-1",
      "order-3",
    ]);
  });

  it("ignores setActive for an unknown key", () => {
    useOrders.getState().setActive("order-99");
    expect(useOrders.getState().activeKey).toBe("order-1");
  });

  it("never reuses order numbers within the session", () => {
    useOrders.getState().addOrder();
    useOrders.getState().closeOrder("order-1");
    useOrders.getState().addOrder();
    expect(useOrders.getState().orders.map((o) => o.label)).toEqual([
      "Order #2",
      "Order #3",
    ]);
    expect(useOrders.getState().nextNumber).toBe(4);
  });

  it("closing the last order creates a fresh order", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().closeOrder("order-1");
    const state = useOrders.getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      key: "order-2",
      label: "Order #2",
      lines: [],
      payment: "cash",
      status: "open",
      sale: null,
    });
    expect(state.activeKey).toBe("order-2");
    expect(state.nextNumber).toBe(3);
  });

  it("edits lines within one order only", () => {
    const state = useOrders.getState();
    state.addOrder();
    const second = useOrders.getState().activeKey;

    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 2);
    expect(order("order-1").lines).toEqual([
      { menu_item_id: 1, qty: 2 },
      { menu_item_id: 2, qty: 1 },
    ]);
    expect(order(second).lines).toEqual([]);

    useOrders.getState().setQty("order-1", 1, 3);
    expect(order("order-1").lines[0]).toEqual({ menu_item_id: 1, qty: 3 });

    useOrders.getState().setQty("order-1", 1, 0);
    expect(order("order-1").lines).toEqual([{ menu_item_id: 2, qty: 1 }]);

    useOrders.getState().removeLine("order-1", 2);
    expect(order("order-1").lines).toEqual([]);
  });

  it("clearOrder resets lines, payment, status, and sale but keeps the tab", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().setPayment("order-1", "gcash");
    useOrders.getState().clearOrder("order-1");
    expect(order("order-1")).toMatchObject({
      key: "order-1",
      label: "Order #1",
      lines: [],
      payment: "cash",
      status: "open",
      sale: null,
    });
  });

  it("derives each order total from menu prices", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addOrder();
    const second = useOrders.getState().activeKey;
    useOrders.getState().addItem(second, 2);

    expect(cartTotalCents(order("order-1").lines, items)).toBe(14000);
    expect(cartTotalCents(order(second).lines, items)).toBe(8000);
    expect(cartTotalCents([], items)).toBe(0);
  });
});
