import { beforeEach, describe, expect, it } from "vitest";
import { cartTotalCents, useCart } from "./cart";
import type { MenuItem } from "../api/menu";

beforeEach(() => {
  useCart.getState().clear();
});

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1 },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1 },
];

describe("cart store", () => {
  it("add appends a new line, then increments qty for the same item", () => {
    const { add } = useCart.getState();
    add(1);
    expect(useCart.getState().lines).toEqual([{ menu_item_id: 1, qty: 1 }]);
    add(1);
    expect(useCart.getState().lines).toEqual([{ menu_item_id: 1, qty: 2 }]);
    add(2);
    expect(useCart.getState().lines).toEqual([
      { menu_item_id: 1, qty: 2 },
      { menu_item_id: 2, qty: 1 },
    ]);
  });

  it("setQty updates the line and drops it at zero", () => {
    const store = useCart.getState();
    store.add(1);
    store.setQty(1, 3);
    expect(useCart.getState().lines).toEqual([{ menu_item_id: 1, qty: 3 }]);
    store.setQty(1, 0);
    expect(useCart.getState().lines).toEqual([]);
  });

  it("remove drops only the matching line", () => {
    const store = useCart.getState();
    store.add(1);
    store.add(2);
    store.remove(1);
    expect(useCart.getState().lines).toEqual([{ menu_item_id: 2, qty: 1 }]);
  });

  it("clear empties the cart", () => {
    const store = useCart.getState();
    store.add(1);
    store.add(2);
    store.clear();
    expect(useCart.getState().lines).toEqual([]);
  });

  it("derives the total from menu prices", () => {
    expect(
      cartTotalCents(
        [
          { menu_item_id: 1, qty: 2 },
          { menu_item_id: 2, qty: 1 },
        ],
        items,
      ),
    ).toBe(22000);
    expect(cartTotalCents([], items)).toBe(0);
  });
});
