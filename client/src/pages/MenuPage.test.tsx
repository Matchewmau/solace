import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MenuShowcase } from "./MenuPage";
import type { Category, MenuItem } from "../api/menu";

afterEach(() => cleanup());

const categories: Category[] = [
  { id: 2, name: "Non-Coffee", sort: 2 },
  { id: 1, name: "Espresso", sort: 1 },
];

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1, variants: [] },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1, variants: [] },
  { id: 3, category_id: 2, name: "Calamansi Cooler", price_cents: 5000, cost_cents: 1200, active: 1, variants: [] },
  { id: 4, category_id: 1, name: "Retired Blend", price_cents: 9000, cost_cents: 3000, active: 0, variants: [] },
];

describe("MenuShowcase with mocked query data", () => {
  it("renders all category headings and item names with whole-peso prices", () => {
    render(<MenuShowcase categories={categories} items={items} />);

    expect(screen.getByRole("heading", { name: "Espresso" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Non-Coffee" })).toBeDefined();
    expect(screen.getByText("Cortado")).toBeDefined();
    expect(screen.getByText("Latte")).toBeDefined();
    expect(screen.getByText("Calamansi Cooler")).toBeDefined();
    expect(screen.getByText("₱70")).toBeDefined();
    expect(screen.getByText("₱80")).toBeDefined();
    expect(screen.getByText("₱50")).toBeDefined();
  });

  it("excludes inactive items", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    expect(screen.queryByText("Retired Blend")).toBeNull();
  });

  it("orders categories by sort, then name", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.textContent)).toEqual(["Espresso", "Non-Coffee"]);
  });

  it("groups items under their category heading", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const espresso = screen.getByLabelText("Espresso");
    expect(within(espresso).getByText("Cortado")).toBeDefined();
    expect(within(espresso).queryByText("Calamansi Cooler")).toBeNull();
  });

  it("shows the empty state when nothing is available", () => {
    render(<MenuShowcase categories={[]} items={[]} />);
    expect(screen.getByText("No items available")).toBeDefined();
  });
});
