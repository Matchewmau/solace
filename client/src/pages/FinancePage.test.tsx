import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinancePage from "./FinancePage";
import { clearStoredAuth } from "../lib/auth";
import type { Dashboard } from "../api/dashboard";
import type { Expense } from "../api/finance";

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
  upcoming_dues: [
    {
      kind: "bill",
      label: "Electric bill",
      amount_cents: 145000,
      due: "18",
      overdue: true,
      days_until: -2,
    },
    {
      kind: "payable",
      label: "Milk supplier",
      amount_cents: 62000,
      due: "2026-10-21",
      overdue: false,
      days_until: 1,
    },
    {
      kind: "loan",
      label: "Bank loan",
      amount_cents: 30000,
      due: "2026-10-30",
      overdue: false,
      days_until: 10,
    },
  ],
  loans: [],
  best_sellers: [],
};

/** Newest dates first, and id descending within the same date. */
const expenses: Expense[] = [
  {
    id: 3,
    date: "2026-10-13",
    category: "Milk",
    amount_cents: 5200,
    note: "Fresh milk",
  },
  {
    id: 7,
    date: "2026-10-01",
    category: "Rent",
    amount_cents: 50000,
    note: "October stall",
  },
  {
    id: 6,
    date: "2026-10-13",
    category: "Ice",
    amount_cents: 1800,
    note: "Two bags",
  },
  {
    id: 2,
    date: "2026-10-05",
    category: "Beans",
    amount_cents: 30000,
    note: "Espresso blend",
  },
  {
    id: 5,
    date: "2026-10-09",
    category: "Cups",
    amount_cents: 12000,
    note: "12 oz",
  },
  {
    id: 4,
    date: "2026-10-01",
    category: "Soap",
    amount_cents: 900,
    note: "Dish soap",
  },
];

function stubDashboard(
  payload: Dashboard = dashboard,
  expenseRows: Expense[] = expenses,
) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/expenses") ? expenseRows : payload;
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
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

    const summary = await screen.findByRole("region", {
      name: "Cash flow · October 2026",
    });
    const moneyIn = within(summary).getByText("Money in").closest("div") as HTMLElement;
    expect(within(moneyIn).getByText("₱303")).toBeDefined();

    const moneyOut = within(summary)
      .getByText("Money out")
      .closest("div") as HTMLElement;
    expect(within(moneyOut).getByText("₱90")).toBeDefined();

    // Net = income 30300 - money out 9000 = 21300, toned ok when positive.
    const net = within(summary).getByText("Net").closest("div") as HTMLElement;
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

describe("FinancePage cash-flow summary", () => {
  it("condenses the month into three stats plus daily and largest notes", async () => {
    stubDashboard();
    renderFinance();

    const summary = await screen.findByRole("region", {
      name: "Cash flow · October 2026",
    });
    expect(within(summary).getByText("Money in")).toBeDefined();
    expect(within(summary).getByText("Money out")).toBeDefined();
    expect(within(summary).getByText("Net")).toBeDefined();
    expect(within(summary).queryByText(/2026-10/)).toBeNull();

    // 9000 cents out across 13 elapsed days = 692.3 → ₱6.92 per day.
    const daily = within(summary)
      .getByText("Daily average")
      .closest("p") as HTMLElement;
    expect(within(daily).getByText("₱6.92")).toBeDefined();
    expect(within(daily).getByText("over 13 days")).toBeDefined();

    // Expenses (4000) is the biggest slice of the 9000 money out.
    const largest = within(summary)
      .getByText("Largest money out")
      .closest("p") as HTMLElement;
    expect(within(largest).getByText("Expenses")).toBeDefined();
    expect(within(largest).getByText("₱40 of ₱90")).toBeDefined();
  });

  it("handles a month with no money out", async () => {
    stubDashboard({
      ...dashboard,
      money_out_month_cents: 0,
      money_out_month_by_kind: {
        bills_cents: 0,
        expenses_cents: 0,
        payables_cents: 0,
        loans_cents: 0,
        salaries_cents: 0,
      },
    });
    renderFinance();

    const summary = await screen.findByRole("region", {
      name: "Cash flow · October 2026",
    });
    const daily = within(summary)
      .getByText("Daily average")
      .closest("p") as HTMLElement;
    expect(within(daily).getByText("₱0")).toBeDefined();
    expect(within(daily).getByText("no money out yet")).toBeDefined();

    const largest = within(summary)
      .getByText("Largest money out")
      .closest("p") as HTMLElement;
    expect(within(largest).getByText("None")).toBeDefined();
  });
});

describe("FinancePage upcoming dues", () => {
  it("lists dues with overdue/due-soon badges and ledger links", async () => {
    stubDashboard();
    renderFinance();

    const dues = await screen.findByRole("region", { name: "Upcoming dues" });

    const electric = within(dues)
      .getByText("Electric bill")
      .closest("li") as HTMLElement;
    expect(within(electric).getByText("₱1450")).toBeDefined();
    expect(within(electric).getByText("18")).toBeDefined();
    const overdue = within(electric).getByText("Overdue");
    expect(overdue.className).toContain("text-danger");
    expect(
      within(electric)
        .getByRole("link", { name: /Electric bill/ })
        .getAttribute("href"),
    ).toBe("/finance/bills");

    const milk = within(dues).getByText("Milk supplier").closest("li") as HTMLElement;
    expect(within(milk).getByText("₱620")).toBeDefined();
    expect(within(milk).getByText("Due tomorrow")).toBeDefined();
    expect(
      within(milk)
        .getByRole("link", { name: /Milk supplier/ })
        .getAttribute("href"),
    ).toBe("/finance/payables");

    const loan = within(dues).getByText("Bank loan").closest("li") as HTMLElement;
    expect(within(loan).getByText("Due in 10 days")).toBeDefined();
    expect(
      within(loan).getByRole("link", { name: /Bank loan/ }).getAttribute("href"),
    ).toBe("/finance/loans");
  });

  it("shows an empty state when nothing is due", async () => {
    stubDashboard({ ...dashboard, upcoming_dues: [] });
    renderFinance();

    const dues = await screen.findByRole("region", { name: "Upcoming dues" });
    expect(
      within(dues).getByText("Nothing due in the next 7 days."),
    ).toBeDefined();
  });
});

describe("FinancePage recent expenses", () => {
  it("shows the five newest expenses, latest date first then newest id", async () => {
    stubDashboard();
    renderFinance();

    const recent = await screen.findByRole("region", {
      name: "Recent expenses",
    });
    await within(recent).findByText("Two bags");

    const rows = within(recent).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain("Ice");
    expect(rows[1].textContent).toContain("Milk");
    expect(rows[2].textContent).toContain("Cups");
    expect(rows[3].textContent).toContain("Beans");
    expect(rows[4].textContent).toContain("Rent");
    // The sixth, oldest expense is outside the five-row window.
    expect(within(recent).queryByText("Soap")).toBeNull();

    expect(
      within(recent).getByRole("link", { name: "View all" }).getAttribute("href"),
    ).toBe("/finance/expenses");
  });

  it("shows an empty state when no expenses are logged", async () => {
    stubDashboard(dashboard, []);
    renderFinance();

    const recent = await screen.findByRole("region", {
      name: "Recent expenses",
    });
    expect(
      await within(recent).findByText("No expenses logged yet."),
    ).toBeDefined();
  });
});
