import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cartTotalCents,
  loadOrdersSnapshot,
  ORDERS_STORAGE_KEY,
  useOrders,
} from "./orders";
import { utcToday, type Sale } from "../api/sales";
import type { MenuItem } from "../api/menu";

function resetOrders() {
  localStorage.removeItem(ORDERS_STORAGE_KEY);
  useOrders.setState({
    orders: [
      {
        key: "order-1",
        label: "Order #1",
        lines: [],
        payment: "cash",
        status: "open",
        sale: null,
        dailySeq: null,
        tempNo: 1,
      },
    ],
    activeKey: "order-1",
    day: utcToday(),
    rolloverCue: false,
  });
}

beforeEach(() => {
  resetOrders();
});

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1, variants: [] },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1, variants: [] },
  { id: 3, category_id: 3, name: "Siomai", price_cents: 5000, cost_cents: 1500, active: 1, variants: ["Fried", "Steamed"] },
];

function saleFixture(overrides?: Partial<Sale>): Sale {
  return {
    id: 7,
    daily_seq: 3,
    total_cents: 7000,
    payment: "cash",
    voided: 0,
    paid: 0,
    created_at: "2026-10-13 10:00:00",
    items: [],
    ...overrides,
  };
}

function order(key: string) {
  const found = useOrders.getState().orders.find((o) => o.key === key);
  if (!found) throw new Error(`missing order ${key}`);
  return found;
}

function labels() {
  return useOrders.getState().orders.map((o) => o.label);
}

function keys() {
  return useOrders.getState().orders.map((o) => o.key);
}

describe("orders store", () => {
  it("starts with one temp order (Order #1, no dailySeq)", () => {
    const state = useOrders.getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      key: "order-1",
      label: "Order #1",
      lines: [],
      payment: "cash",
      status: "open",
      sale: null,
      dailySeq: null,
      tempNo: 1,
    });
    expect(state.activeKey).toBe("order-1");
  });

  it("holds different lines and payments per order independently", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().setPayment("order-1", "cash");
    useOrders.getState().addOrder();
    const second = useOrders.getState().activeKey;
    useOrders.getState().addItem(second, 2);
    useOrders.getState().setPayment(second, "gcash");

    expect(order("order-1").lines).toEqual([
      { menu_item_id: 1, variant: null, qty: 2 },
    ]);
    expect(order("order-1").payment).toBe("cash");
    expect(order(second).lines).toEqual([
      { menu_item_id: 2, variant: null, qty: 1 },
    ]);
    expect(order(second).payment).toBe("gcash");
  });

  it("adds, switches, and closes orders without a monotonic counter", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addOrder();
    expect(labels()).toEqual(["Order #1", "Order #2"]);
    expect(useOrders.getState().activeKey).toBe("order-2");

    useOrders.getState().setActive("order-1");
    expect(useOrders.getState().activeKey).toBe("order-1");

    useOrders.getState().closeOrder("order-2");
    expect(keys()).toEqual(["order-1"]);
    expect(useOrders.getState().activeKey).toBe("order-1");
  });

  it("addOrder reaps empty temps and derives temp numbers from remaining tabs", () => {
    // Fresh empty tab: New order reaps and recreates it — no count bump.
    useOrders.getState().addOrder();
    expect(keys()).toEqual(["order-1"]);
    expect(labels()).toEqual(["Order #1"]);

    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addOrder();
    expect(labels()).toEqual(["Order #1", "Order #2"]);

    // The second tab is an empty temp, so the next New order reaps it.
    useOrders.getState().setActive("order-1");
    useOrders.getState().addOrder();
    expect(keys()).toEqual(["order-1", "order-2"]);
    expect(useOrders.getState().activeKey).toBe("order-2");
  });

  it("falls back to a remaining order when the active order is closed", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addOrder();
    useOrders.getState().addItem("order-2", 2);
    useOrders.getState().addOrder();
    useOrders.getState().setActive("order-2");
    useOrders.getState().closeOrder("order-2");
    expect(useOrders.getState().activeKey).toBe("order-3");
    expect(keys()).toEqual(["order-1", "order-3"]);
  });

  it("ignores setActive for an unknown key", () => {
    useOrders.getState().setActive("order-99");
    expect(useOrders.getState().activeKey).toBe("order-1");
  });

  it("closing the last order creates a fresh temp order", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().closeOrder("order-1");
    const state = useOrders.getState();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({
      key: "order-1",
      label: "Order #1",
      lines: [],
      payment: "cash",
      status: "open",
      sale: null,
      dailySeq: null,
      tempNo: 1,
    });
    expect(state.activeKey).toBe("order-1");
  });

  it("edits lines within one order only", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 2);
    useOrders.getState().addOrder();
    const second = useOrders.getState().activeKey;

    expect(order("order-1").lines).toEqual([
      { menu_item_id: 1, variant: null, qty: 2 },
      { menu_item_id: 2, variant: null, qty: 1 },
    ]);
    expect(order(second).lines).toEqual([]);

    useOrders.getState().setQty("order-1", 1, null, 3);
    expect(order("order-1").lines[0]).toEqual({
      menu_item_id: 1,
      variant: null,
      qty: 3,
    });

    useOrders.getState().setQty("order-1", 1, null, 0);
    expect(order("order-1").lines).toEqual([
      { menu_item_id: 2, variant: null, qty: 1 },
    ]);

    useOrders.getState().removeLine("order-1", 2, null);
    expect(order("order-1").lines).toEqual([]);
  });

  it("clearOrder resets lines, payment, status, sale, and dailySeq but keeps the tab", () => {
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
      dailySeq: null,
    });
  });

  it("clearOrder on a bound tab restores the temp label, not the stale bound one", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().completeOrder(
      "order-1",
      saleFixture({ id: 7, daily_seq: 5 }),
    );
    expect(order("order-1").label).toBe("Order #5");

    useOrders.getState().clearOrder("order-1");
    expect(order("order-1")).toMatchObject({
      key: "order-1",
      label: "Order #1",
      lines: [],
      payment: "cash",
      status: "open",
      sale: null,
      dailySeq: null,
      tempNo: 1,
    });
  });

  it("new temp numbers skip bound numbers already in use", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().completeOrder(
      "order-1",
      saleFixture({ id: 7, daily_seq: 2 }),
    );
    expect(order("order-1").label).toBe("Order #2");

    useOrders.getState().addOrder();
    const second = useOrders.getState().activeKey;
    expect(order(second)).toMatchObject({ tempNo: 3, label: "Order #3" });
    expect(labels()).toEqual(["Order #2", "Order #3"]);
  });

  it("completeOrder binds the daily number and never overwrites a done order", () => {
    useOrders.getState().addItem("order-1", 1);
    const first = saleFixture({ id: 7, daily_seq: 3 });
    useOrders.getState().completeOrder("order-1", first);
    expect(order("order-1")).toMatchObject({
      status: "done",
      sale: first,
      dailySeq: 3,
      label: "Order #3",
    });
    useOrders
      .getState()
      .completeOrder("order-1", saleFixture({ id: 8, daily_seq: 9 }));
    expect(order("order-1").sale).toMatchObject({ id: 7 });
    expect(order("order-1")).toMatchObject({ dailySeq: 3, label: "Order #3" });
  });

  it("completeOrder ignores a sale without a valid daily_seq", () => {
    useOrders.getState().addItem("order-1", 1);
    for (const seq of [undefined, 0, -2, 1.5] as unknown[]) {
      useOrders.getState().completeOrder(
        "order-1",
        { ...saleFixture(), daily_seq: seq } as unknown as Sale,
      );
    }
    expect(order("order-1")).toMatchObject({
      status: "open",
      sale: null,
      dailySeq: null,
      label: "Order #1",
      tempNo: 1,
    });
  });

  it("edits on a done order are no-ops (open guard)", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().completeOrder("order-1", saleFixture());
    const before = order("order-1");

    useOrders.getState().addItem("order-1", 2);
    useOrders.getState().setQty("order-1", 1, null, 9);
    useOrders.getState().removeLine("order-1", 1, null);
    useOrders.getState().setPayment("order-1", "gcash");

    expect(order("order-1")).toEqual(before);
    expect(order("order-1").status).toBe("done");
  });

  it("binds dailySeq only on completeOrder and resets temp on UTC day change", () => {
    const active = () => order(useOrders.getState().activeKey);
    const fixture = {
      id: 7,
      total_cents: 7000,
      payment: "cash" as const,
      voided: 0,
      paid: 0,
      created_at: "2026-10-13 10:00:00",
      items: [],
    };
    useOrders.getState().addOrder();
    expect(active().dailySeq).toBeNull();
    useOrders.getState().completeOrder(active().key, { ...fixture, daily_seq: 3 } as Sale);
    expect(active().label).toBe("Order #3");
  });

  it("reopenForEdit flips a done-but-unpaid tab back to open keeping the sale", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().completeOrder(
      "order-1",
      saleFixture({ id: 7, daily_seq: 3, paid: 0 }),
    );
    expect(order("order-1").status).toBe("done");

    useOrders.getState().reopenForEdit("order-1");
    expect(order("order-1")).toMatchObject({
      status: "open",
      dailySeq: 3,
      label: "Order #3",
    });
    expect(order("order-1").sale).toMatchObject({ id: 7 });

    // The reopened tab accepts brand-new items again.
    useOrders.getState().addItem("order-1", 2);
    expect(order("order-1").lines).toContainEqual({
      menu_item_id: 2,
      variant: null,
      qty: 1,
    });
  });

  it("reopenForEdit is a no-op for paid or open orders", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().completeOrder(
      "order-1",
      saleFixture({ id: 7, daily_seq: 3, paid: 1 }),
    );
    useOrders.getState().reopenForEdit("order-1");
    expect(order("order-1").status).toBe("done");

    resetOrders();
    useOrders.getState().reopenForEdit("order-1");
    expect(order("order-1").status).toBe("open");
    expect(order("order-1").sale).toBeNull();
  });

  it("discardEmpty removes a never-posted empty tab and fixes the active key", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addOrder();
    expect(useOrders.getState().activeKey).toBe("order-2");

    useOrders.getState().discardEmpty("order-2");
    expect(keys()).toEqual(["order-1"]);
    expect(useOrders.getState().activeKey).toBe("order-1");

    // Tabs with lines are kept.
    useOrders.getState().discardEmpty("order-1");
    expect(keys()).toEqual(["order-1"]);
  });

  it("discardEmpty on the last tab leaves a fresh empty order", () => {
    useOrders.getState().discardEmpty("order-1");
    expect(keys()).toEqual(["order-1"]);
    expect(order("order-1")).toMatchObject({
      lines: [],
      sale: null,
      status: "open",
    });
    expect(useOrders.getState().activeKey).toBe("order-1");
  });

  it("discardEmpty keeps tabs holding a sale", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().completeOrder("order-1", saleFixture({ paid: 0 }));
    useOrders.getState().discardEmpty("order-1");
    expect(keys()).toEqual(["order-1"]);
    expect(order("order-1").status).toBe("done");
  });

  it("persists orders, activeKey, and the UTC date to localStorage", () => {
    useOrders.getState().addItem("order-1", 1);
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const snapshot = JSON.parse(raw as string) as {
      utcDate: string;
      activeKey: string;
      orders: unknown[];
    };
    expect(snapshot.utcDate).toBe(utcToday());
    expect(snapshot.activeKey).toBe("order-1");
    expect(snapshot.orders).toHaveLength(1);
    expect(snapshot.orders[0]).toMatchObject({ key: "order-1", tempNo: 1 });
  });

  it("loadOrdersSnapshot restores same-day tabs and reaps empty temps", () => {
    const raw = JSON.stringify({
      version: 1,
      utcDate: utcToday(),
      activeKey: "order-2",
      orders: [
        {
          key: "order-1",
          label: "Order #1",
          lines: [],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 1,
        },
        {
          key: "order-2",
          label: "Order #2",
          lines: [{ menu_item_id: 1, qty: 2 }],
          payment: "gcash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 2,
        },
        {
          key: "order-3",
          label: "Order #5",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: saleFixture({ id: 11, daily_seq: 5 }),
          dailySeq: 5,
          tempNo: 3,
        },
      ],
    });
    const loaded = loadOrdersSnapshot(raw, utcToday());
    expect(loaded?.orders.map((o) => o.key)).toEqual(["order-2", "order-3"]);
    expect(loaded?.activeKey).toBe("order-2");
    expect(loaded?.orders[1]).toMatchObject({ label: "Order #5", dailySeq: 5 });
  });

  it("loadOrdersSnapshot recomputes stored labels that disagree with the numbers", () => {
    const raw = JSON.stringify({
      version: 1,
      utcDate: utcToday(),
      activeKey: "order-3",
      orders: [
        {
          key: "order-3",
          label: "Order #99",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: saleFixture({ id: 11, daily_seq: 5 }),
          dailySeq: 5,
          tempNo: 3,
        },
        {
          key: "order-2",
          label: "Bogus",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 2,
        },
      ],
    });
    const loaded = loadOrdersSnapshot(raw, utcToday());
    expect(loaded?.orders.map((o) => o.label)).toEqual([
      "Order #5",
      "Order #2",
    ]);
  });

  it("loadOrdersSnapshot falls back when the stored active key is gone", () => {
    const raw = JSON.stringify({
      version: 1,
      utcDate: utcToday(),
      activeKey: "order-9",
      orders: [
        {
          key: "order-2",
          label: "Order #2",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 2,
        },
      ],
    });
    const loaded = loadOrdersSnapshot(raw, utcToday());
    expect(loaded?.activeKey).toBe("order-2");
  });

  it("loadOrdersSnapshot drops everything when the UTC date changes", () => {
    const raw = JSON.stringify({
      version: 1,
      utcDate: "2020-01-01",
      activeKey: "order-2",
      orders: [
        {
          key: "order-2",
          label: "Order #2",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 2,
        },
      ],
    });
    expect(loadOrdersSnapshot(raw, utcToday())).toBeNull();
  });

  it("loadOrdersSnapshot rejects corrupt snapshots", () => {
    expect(loadOrdersSnapshot(null, utcToday())).toBeNull();
    expect(loadOrdersSnapshot("not-json", utcToday())).toBeNull();
    expect(
      loadOrdersSnapshot(JSON.stringify({ version: 2 }), utcToday()),
    ).toBeNull();
    expect(
      loadOrdersSnapshot(
        JSON.stringify({ version: 1, utcDate: utcToday(), orders: [], activeKey: "order-1" }),
        utcToday(),
      ),
    ).toBeNull();
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

describe("orders store variant lines", () => {
  const siomaiId = 3;

  it("keeps Fried and Steamed as separate lines", () => {
    useOrders.getState().addItem("order-1", siomaiId, "Fried");
    useOrders.getState().addItem("order-1", siomaiId, "Steamed");
    expect(order("order-1").lines).toHaveLength(2);
    expect(order("order-1").lines).toEqual([
      { menu_item_id: siomaiId, variant: "Fried", qty: 1 },
      { menu_item_id: siomaiId, variant: "Steamed", qty: 1 },
    ]);
  });

  it("merges same-variant taps and setQty targets the addressed variant line", () => {
    useOrders.getState().addItem("order-1", siomaiId, "Fried");
    useOrders.getState().addItem("order-1", siomaiId, "Fried");
    useOrders.getState().addItem("order-1", siomaiId, "Steamed");
    expect(order("order-1").lines).toEqual([
      { menu_item_id: siomaiId, variant: "Fried", qty: 2 },
      { menu_item_id: siomaiId, variant: "Steamed", qty: 1 },
    ]);

    useOrders.getState().setQty("order-1", siomaiId, "Steamed", 3);
    expect(order("order-1").lines).toEqual([
      { menu_item_id: siomaiId, variant: "Fried", qty: 2 },
      { menu_item_id: siomaiId, variant: "Steamed", qty: 3 },
    ]);

    // Zero qty drops only the addressed variant line.
    useOrders.getState().setQty("order-1", siomaiId, "Steamed", 0);
    expect(order("order-1").lines).toEqual([
      { menu_item_id: siomaiId, variant: "Fried", qty: 2 },
    ]);
  });

  it("removeLine removes only the addressed variant line", () => {
    useOrders.getState().addItem("order-1", siomaiId, "Fried");
    useOrders.getState().addItem("order-1", siomaiId, "Steamed");
    useOrders.getState().removeLine("order-1", siomaiId, "Fried");
    expect(order("order-1").lines).toEqual([
      { menu_item_id: siomaiId, variant: "Steamed", qty: 1 },
    ]);
  });

  it("null or omitted variant keeps the old single-line behavior", () => {
    useOrders.getState().addItem("order-1", 1);
    useOrders.getState().addItem("order-1", 1, null);
    expect(order("order-1").lines).toEqual([
      { menu_item_id: 1, variant: null, qty: 2 },
    ]);

    // A variant tap cannot merge into the plain (null) line.
    useOrders.getState().addItem("order-1", 1, "Iced");
    expect(order("order-1").lines).toEqual([
      { menu_item_id: 1, variant: null, qty: 2 },
      { menu_item_id: 1, variant: "Iced", qty: 1 },
    ]);
  });

  it("persists variant lines through a storage reload", () => {
    useOrders.getState().addItem("order-1", siomaiId, "Fried");
    useOrders.getState().addItem("order-1", siomaiId, "Steamed");
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const loaded = loadOrdersSnapshot(raw, utcToday());
    expect(loaded?.orders[0].lines).toEqual([
      { menu_item_id: siomaiId, variant: "Fried", qty: 1 },
      { menu_item_id: siomaiId, variant: "Steamed", qty: 1 },
    ]);
  });

  it("sanitize defaults a missing stored variant to null (pre-variant snapshots)", () => {
    const raw = JSON.stringify({
      version: 1,
      utcDate: utcToday(),
      activeKey: "order-2",
      orders: [
        {
          key: "order-2",
          label: "Order #2",
          lines: [
            { menu_item_id: 3, variant: "Fried", qty: 2 },
            { menu_item_id: 3, variant: "Steamed", qty: 1 },
            { menu_item_id: 1, qty: 4 },
          ],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 2,
        },
      ],
    });
    const loaded = loadOrdersSnapshot(raw, utcToday());
    expect(loaded?.orders[0].lines).toEqual([
      { menu_item_id: 3, variant: "Fried", qty: 2 },
      { menu_item_id: 3, variant: "Steamed", qty: 1 },
      { menu_item_id: 1, variant: null, qty: 4 },
    ]);
  });

  it("openSaleTab carries server line variants onto the bound tab", () => {
    useOrders.getState().openSaleTab(
      saleFixture({
        items: [
          { id: 1, menu_item_id: 3, qty: 2, unit_price_cents: 5000, variant: "Fried" },
          { id: 2, menu_item_id: 3, qty: 1, unit_price_cents: 5000, variant: "Steamed" },
          { id: 3, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null },
        ],
      }),
    );
    const tab = order(useOrders.getState().activeKey);
    expect(tab.status).toBe("done");
    expect(tab.lines).toEqual([
      { menu_item_id: 3, variant: "Fried", qty: 2 },
      { menu_item_id: 3, variant: "Steamed", qty: 1 },
      { menu_item_id: 1, variant: null, qty: 1 },
    ]);
  });
});

describe("orders store cross-tab sync and day rollover", () => {
  it("a storage event from another tab replaces the rail", () => {
    const raw = JSON.stringify({
      version: 1,
      utcDate: utcToday(),
      activeKey: "order-2",
      orders: [
        {
          key: "order-1",
          label: "stale label",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 1,
        },
        {
          key: "order-2",
          label: "Order #2",
          lines: [{ menu_item_id: 2, qty: 3 }],
          payment: "gcash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 2,
        },
      ],
    });

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ORDERS_STORAGE_KEY,
        newValue: raw,
      }),
    );

    const state = useOrders.getState();
    expect(state.orders.map((o) => o.key)).toEqual(["order-1", "order-2"]);
    // Stored labels are recomputed from the numbers on the way in.
    expect(state.orders.map((o) => o.label)).toEqual(["Order #1", "Order #2"]);
    expect(order("order-2").lines).toEqual([
      { menu_item_id: 2, variant: null, qty: 3 },
    ]);
    expect(state.activeKey).toBe("order-2");
  });

  it("ignores storage events for other keys or malformed values", () => {
    const before = useOrders.getState().orders;

    window.dispatchEvent(
      new StorageEvent("storage", { key: "solace:other:v1", newValue: "{}" }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ORDERS_STORAGE_KEY,
        newValue: "not-json",
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: ORDERS_STORAGE_KEY, newValue: null }),
    );

    expect(useOrders.getState().orders).toBe(before);
    expect(keys()).toEqual(["order-1"]);
  });

  it("an identical write does not echo", () => {
    useOrders.getState().addItem("order-1", 1);
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY) as string;
    const spy = vi.spyOn(Storage.prototype, "setItem");

    // The other tab broadcasts exactly what this tab already has stored.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ORDERS_STORAGE_KEY,
        newValue: raw,
      }),
    );

    expect(spy).not.toHaveBeenCalledWith(ORDERS_STORAGE_KEY, raw);
    spy.mockRestore();
  });

  it("a stale day resets on first interaction", () => {
    vi.useFakeTimers();
    try {
      // Set up a rail on 2026-10-17 with a line the new day must not carry.
      vi.setSystemTime("2026-10-17T23:30:00Z");
      useOrders.setState({ day: "2026-10-17", rolloverCue: false });
      useOrders.getState().addItem("order-1", 2);
      expect(order("order-1").lines).toEqual([
        { menu_item_id: 2, variant: null, qty: 1 },
      ]);
      expect(useOrders.getState().day).toBe("2026-10-17");

      // The day turns; the first touch resets the rail before it lands.
      vi.setSystemTime("2026-10-18T01:00:00Z");
      useOrders.getState().addItem("order-1", 1);

      const state = useOrders.getState();
      expect(state.orders).toHaveLength(1);
      expect(state.orders[0].key).toBe("order-1");
      expect(state.day).toBe("2026-10-18");
      expect(state.rolloverCue).toBe(true);
      // The stale item #2 line is gone; the triggering tap landed on the
      // fresh Order #1 (its key survives the reset).
      expect(order("order-1").lines).toEqual([
        { menu_item_id: 1, variant: null, qty: 1 },
      ]);

      state.dismissRolloverCue();
      expect(useOrders.getState().rolloverCue).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persisted snapshot carries the current day", () => {
    useOrders.getState().addItem("order-1", 1);
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY) as string;
    expect(raw).not.toBeNull();
    const snapshot = JSON.parse(raw) as { utcDate: string };
    expect(snapshot.utcDate).toBe(utcToday());
    expect(useOrders.getState().day).toBe(utcToday());
  });
});
