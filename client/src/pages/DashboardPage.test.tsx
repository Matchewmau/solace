import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import type { Dashboard } from "../api/dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Net math: day 13800 - 4000 = 9800; month 30300 - 5000 = 25300.
const payload: Dashboard = {
  date: "2026-10-13",
  month: "2026-10",
  income_day: { cash_cents: 10000, gcash_cents: 3800, total_cents: 13800, count: 2 },
  income_month: {
    cash_cents: 26500,
    gcash_cents: 3800,
    total_cents: 30300,
    count: 3,
  },
  expenses_day_cents: 4000,
  expenses_month_cents: 5000,
  net_day_cents: 9800,
  net_month_cents: 25300,
  unpaid_bills_cents: 300000,
  unpaid_payables_cents: 100000,
  upcoming_dues: [
    { kind: "bill", label: "Meralco", amount_cents: 250000, due: "05" },
    { kind: "payable", label: "Overdue", amount_cents: 40000, due: "2026-10-01" },
  ],
  outstanding_loans_cents: 90000,
  loans: [{ id: 1, lender: "BDO", balance_cents: 90000 }],
  best_sellers: [
    { menu_item_id: 1, name: "Item One", qty: 10, revenue_cents: 10000 },
    { menu_item_id: 2, name: "Item Two", qty: 8, revenue_cents: 16000 },
  ],
};

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardPage with mocked payload", () => {
  it("renders every section with the net math displayed", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }) as Response) as typeof fetch;

    renderDashboard();

    // Net hero: income total minus expenses, formatted as pesos.
    expect(await screen.findByText("Day net ₱98")).toBeTruthy();
    expect(screen.getByText("Month net ₱253")).toBeTruthy();

    // Income split cash/GCash + expenses lines.
    expect(screen.getByText(/Day cash ₱100/)).toBeTruthy();
    expect(screen.getByText(/Day GCash ₱38/)).toBeTruthy();
    expect(screen.getByText("Day ₱40")).toBeTruthy();
    expect(screen.getByText("Month ₱50")).toBeTruthy();

    // Unpaid stock lines (separate from net).
    expect(screen.getByText(/Unpaid bills ₱3000/)).toBeTruthy();
    expect(screen.getByText(/Unpaid payables ₱1000/)).toBeTruthy();

    // Upcoming dues, loans, best sellers.
    expect(screen.getByText(/Meralco — ₱2500 — due 05/)).toBeTruthy();
    expect(screen.getByText(/Overdue — ₱400 — due 2026-10-01/)).toBeTruthy();
    expect(screen.getByText("Total ₱900")).toBeTruthy();
    expect(screen.getByText(/BDO — balance ₱900/)).toBeTruthy();
    expect(screen.getByText(/Item One — 10 sold — ₱100/)).toBeTruthy();
    expect(screen.getByText(/Item Two — 8 sold — ₱160/)).toBeTruthy();

    // No duplicating inline nav: the global rail owns every tab.
    // Scoped to landmarks so future card-body copy stays green.
    expect(screen.queryByRole("navigation", { name: "Dashboard" })).toBeNull();
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
    const main = screen.getByRole("main");
    for (const label of ["Menu", "POS", "Finance", "Guide", "Inventory"]) {
      expect(within(main).queryByRole("link", { name: label })).toBeNull();
    }
  });

  it("shows empty states when dues, loans, and sellers are all clear", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...payload,
        upcoming_dues: [],
        loans: [],
        best_sellers: [],
      }),
    }) as Response) as typeof fetch;

    renderDashboard();
    expect(await screen.findByText("Nothing due right now.")).toBeTruthy();
    expect(screen.getByText("No outstanding loans.")).toBeTruthy();
    expect(screen.getByText("No sales this month.")).toBeTruthy();
  });
});
