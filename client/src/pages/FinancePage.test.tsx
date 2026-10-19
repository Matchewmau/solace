import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinancePage from "./FinancePage";
import { clearStoredAuth } from "../lib/auth";
import type { Dashboard } from "../api/dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

/**
 * Fixture: month income 30300, money out 9000, net 30300 - 9000 = 21300.
 * Donut shares of the 9000 money-out total: bills 3000, expenses 4000,
 * payables 500, loans 500, salaries 1000.
 */
const dashboard: Dashboard = {
  date: "2026-10-13",
  month: "2026-10",
  income_day: { cash_cents: 0, gcash_cents: 0, total_cents: 0, count: 0 },
  income_month: {
    cash_cents: 26500,
    gcash_cents: 3800,
    total_cents: 30300,
    count: 3,
  },
  expenses_day_cents: 0,
  expenses_month_cents: 4000,
  money_out_day_cents: 0,
  money_out_month_cents: 9000,
  money_out_month_by_kind: {
    bills_cents: 3000,
    expenses_cents: 4000,
    payables_cents: 500,
    loans_cents: 500,
    salaries_cents: 1000,
  },
  salaries_month_cents: 1000,
  salaries_month_count: 1,
  net_day_cents: 0,
  net_month_cents: 21300,
  unpaid_bills_cents: 300000,
  unpaid_bills_count: 2,
  unpaid_payables_cents: 100000,
  unpaid_payables_count: 3,
  overdue_payables_count: 1,
  expenses_month_count: 2,
  outstanding_loans_cents: 90000,
  outstanding_loans_count: 1,
  upcoming_dues: [],
  loans: [],
  best_sellers: [],
};

function stubDashboard(payload: Dashboard = dashboard) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

function renderFinance() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FinancePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The boxed group titled `name` (Box renders a named `<section>`). */
function region(name: string) {
  return screen.getByRole("region", { name });
}

describe("FinancePage money dashboard", () => {
  it("renders the money-in / money-out / net strip with month totals", async () => {
    stubDashboard();
    renderFinance();

    const moneyIn = (await screen.findByText(
      "Money in · 2026-10",
    )).closest("div") as HTMLElement;
    expect(within(moneyIn).getByText("₱303")).toBeDefined();

    const moneyOut = screen
      .getByText("Money out · 2026-10")
      .closest("div") as HTMLElement;
    expect(within(moneyOut).getByText("₱90")).toBeDefined();

    // Net = income 30300 - money out 9000 = 21300, toned ok when positive.
    const net = screen.getByText("Net").closest("div") as HTMLElement;
    const netValue = within(net).getByText("₱213");
    expect(netValue.className).toContain("text-ok");
  });

  it("tones a negative net as danger", async () => {
    stubDashboard({ ...dashboard, net_month_cents: -1500 });
    renderFinance();

    const net = (await screen.findByText("Net")).closest("div") as HTMLElement;
    const netValue = within(net).getByText("₱-15");
    expect(netValue.className).toContain("text-danger");
  });

  it("lists all five money-out kinds including salaries", async () => {
    stubDashboard();
    renderFinance();

    const donut = await screen.findByRole("region", {
      name: "Money out by kind",
    });
    // Legend center label echoes the money-out total.
    expect(within(donut).getByText("₱90")).toBeDefined();

    for (const [label, value] of [
      ["Bills", "₱30"],
      ["Expenses", "₱40"],
      ["Payables", "₱5"],
      ["Loans", "₱5"],
      ["Salaries", "₱10"],
    ] as const) {
      const row = within(donut).getByText(label).closest("li") as HTMLElement;
      expect(within(row).getByText(value)).toBeDefined();
      expect(row.textContent).toMatch(/\d+%/);
    }
  });

  it("shows the salaries drill box with the month total and count", async () => {
    stubDashboard();
    renderFinance();

    const salaries = await screen.findByRole("region", { name: "Salaries" });
    expect(within(salaries).getByText("₱10")).toBeDefined();
    expect(within(salaries).getByText("1 paid this month")).toBeDefined();
    expect(
      within(salaries).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/salaries");
  });

  it("renders the five drill-in boxes with numbers, hints, and Open links", async () => {
    stubDashboard();
    renderFinance();

    const bills = await screen.findByRole("region", { name: "Bills" });
    expect(within(bills).getByText("₱3000")).toBeDefined();
    expect(within(bills).getByText("2 unpaid")).toBeDefined();
    expect(
      within(bills).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/bills");

    const expenses = region("Expenses");
    expect(within(expenses).getByText("₱40")).toBeDefined();
    expect(within(expenses).getByText("2 this month")).toBeDefined();
    expect(
      within(expenses).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/expenses");

    const payables = region("Payables");
    expect(within(payables).getByText("₱1000")).toBeDefined();
    expect(within(payables).getByText("3 open")).toBeDefined();
    const overdue = within(payables).getByText("1 overdue");
    expect(overdue.className).toContain("text-danger");
    expect(
      within(payables).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/payables");

    const loans = region("Loans");
    expect(within(loans).getByText("₱900")).toBeDefined();
    expect(within(loans).getByText("1 outstanding")).toBeDefined();
    expect(
      within(loans).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/loans");

    const salaries = region("Salaries");
    expect(within(salaries).getByText("₱10")).toBeDefined();
    expect(within(salaries).getByText("1 paid this month")).toBeDefined();
    expect(
      within(salaries).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/salaries");
  });

  it("hides the overdue badge when nothing is overdue", async () => {
    stubDashboard({ ...dashboard, overdue_payables_count: 0 });
    renderFinance();

    const payables = await screen.findByRole("region", { name: "Payables" });
    expect(within(payables).queryByText(/overdue/i)).toBeNull();
  });

  it("preserves the loading and error/retry states", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as typeof fetch;

    renderFinance();
    expect(
      await screen.findByText("Could not load finance."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });
});
