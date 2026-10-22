import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "./DashboardPage";
import type { Dashboard } from "../api/dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Calendar week Mon 12 → Sun 18; totals climb 1000…7000. */
const WEEK_SALES = Array.from({ length: 7 }, (_, index) => ({
  date: `2026-10-${String(index + 12).padStart(2, "0")}`,
  total_cents: (index + 1) * 1000,
}));

/** Every day in October; only four selling days, summing to 40000. */
const MONTH_DAILY_TOTALS: Record<string, number> = {
  "2026-10-01": 8000,
  "2026-10-05": 6000,
  "2026-10-14": 10000,
  "2026-10-31": 16000,
};
const MONTH_SALES = Array.from({ length: 31 }, (_, index) => {
  const date = `2026-10-${String(index + 1).padStart(2, "0")}`;
  return { date, total_cents: MONTH_DAILY_TOTALS[date] ?? 0 };
});

// Month net math: 40000 − 11000 = 29000. Average/day = 40000 ÷ 4 selling days.
const dashboard: Dashboard = {
  date: "2026-10-14",
  month: "2026-10",
  income_day: { cash_cents: 10000, gcash_cents: 3800, total_cents: 13800, count: 2 },
  income_week: {
    cash_cents: 20000,
    gcash_cents: 5000,
    total_cents: 25000,
    count: 4,
  },
  income_month: {
    cash_cents: 30000,
    gcash_cents: 10000,
    total_cents: 40000,
    count: 5,
  },
  expenses_month_cents: 5000,
  money_out_month_cents: 11000,
  money_out_month_by_kind: {
    bills_cents: 4000,
    expenses_cents: 5000,
    payables_cents: 1000,
    loans_cents: 0,
    salaries_cents: 1000,
  },
  salaries_month_cents: 1000,
  salaries_month_count: 1,
  sales_by_day_week: WEEK_SALES,
  sales_by_day_month: MONTH_SALES,
  net_month_cents: 29000,
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
      kind: "payable",
      label: "Rice supplier",
      amount_cents: 40000,
      due: "2026-10-10",
      overdue: true,
      days_until: -4,
    },
    {
      kind: "payable",
      label: "Milk supplier",
      amount_cents: 1000,
      due: "2026-10-14",
      overdue: false,
      days_until: 0,
    },
    {
      kind: "loan",
      label: "BDO",
      amount_cents: 10000,
      due: "2026-10-15",
      overdue: false,
      days_until: 1,
    },
    {
      kind: "bill",
      label: "Meralco",
      amount_cents: 250000,
      due: "2026-10-20",
      overdue: false,
      days_until: 6,
    },
  ],
  loans: [{ id: 1, lender: "BDO", balance_cents: 90000 }],
  // Deliberately unsorted: the page must rank best sellers by qty.
  best_sellers_week: [
    { menu_item_id: 2, name: "Halo-halo", qty: 4, revenue_cents: 8000 },
    { menu_item_id: 1, name: "Adobo", qty: 2, revenue_cents: 2000 },
  ],
  best_sellers_month: [
    { menu_item_id: 2, name: "Halo-halo", qty: 8, revenue_cents: 16000 },
    { menu_item_id: 1, name: "Adobo", qty: 10, revenue_cents: 10000 },
  ],
};

function stubDashboard(payload: Dashboard = dashboard) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

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

/** The StatChip element whose label is `label`. */
function chip(label: string) {
  return screen.getByText(label).closest("div") as HTMLElement;
}

describe("DashboardPage", () => {
  it("renders five chips with average day sale and no day net", async () => {
    stubDashboard();
    renderDashboard();

    // Five chips: Day in, Average/day, Month in, Month out, Month net.
    expect(await screen.findByText("Day in")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Dashboard" }).className,
    ).toContain("page-title");
    expect(screen.queryByText("Day out")).toBeNull();
    expect(screen.queryByText("Day net")).toBeNull();
    const strip = screen.getByRole("region", { name: "Money strip" });
    expect(strip.querySelectorAll(".rounded-box")).toHaveLength(5);

    expect(within(chip("Day in")).getByText("₱138")).toBeDefined();
    // (8000 + 6000 + 10000 + 16000) / 4 selling days = 10000 cents.
    expect(within(chip("Average/day")).getByText("₱100")).toBeDefined();
    expect(
      within(chip("Average/day")).getByText("4 selling days"),
    ).toBeDefined();

    expect(within(chip("Month in")).getByText("₱400")).toBeDefined();
    expect(within(chip("Month out")).getByText("₱110")).toBeDefined();
    const monthNet = within(chip("Month net")).getByText("₱290");
    expect(monthNet.className).toContain("text-ok");

    // The subtitle explains the month-only net and average rule.
    expect(
      screen.getByText(/money in minus money out/i),
    ).toBeDefined();
    expect(
      screen.getByText(/salaries, bills, payables, loans, and expenses/i),
    ).toBeDefined();
    expect(screen.getByText(/mean of daily sales totals/i)).toBeDefined();
  });

  it("averages the daily totals for days that had sales", async () => {
    const dailyTotals: Record<number, number> = {
      19: 152000,
      20: 139000,
      21: 107000,
    };
    stubDashboard({
      ...dashboard,
      date: "2026-10-21",
      month: "2026-10",
      income_month: {
        cash_cents: 398000,
        gcash_cents: 0,
        total_cents: 398000,
        count: 3,
      },
      sales_by_day_month: Array.from({ length: 31 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, "0")}`,
        total_cents: dailyTotals[index + 1] ?? 0,
      })),
    });
    renderDashboard();
    expect(await screen.findByText("Average/day")).toBeDefined();
    // (1520 + 1390 + 1070) / 3 selling days = 1326.66…
    expect(within(chip("Average/day")).getByText("₱1326.67")).toBeDefined();
    expect(
      within(chip("Average/day")).getByText("3 selling days"),
    ).toBeDefined();
  });

  it("tones a negative month net as danger", async () => {
    stubDashboard({ ...dashboard, net_month_cents: -2000 });
    renderDashboard();

    expect(await screen.findByText("Month net")).toBeDefined();
    expect(within(chip("Month net")).getByText("₱-20").className).toContain(
      "text-danger",
    );
  });

  it("filters sales by the Monday-Sunday week and calendar month", async () => {
    stubDashboard();
    renderDashboard();

    const sales = await screen.findByRole("region", { name: "Sales" });
    const controls = within(sales).getByRole("group", { name: "Sales period" });
    expect(within(controls).queryByRole("button", { name: "Today" })).toBeNull();
    const week = within(controls).getByRole("button", { name: "Week" });
    const month = within(controls).getByRole("button", { name: "Month" });
    expect(week.getAttribute("aria-pressed")).toBe("true");

    const labels = () =>
      [...sales.querySelectorAll("[data-label]")].map((node) => node.textContent);
    let bars = sales.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(7);
    expect(labels()[0]).toBe("Mon 12");
    expect(labels()[6]).toBe("Sun 18");

    // The peak day fills the column; the smallest is a proportional sliver.
    expect((bars[6] as HTMLElement).style.height).toBe("100%");
    expect((bars[0] as HTMLElement).style.height).not.toBe("100%");

    fireEvent.click(month);
    expect(month.getAttribute("aria-pressed")).toBe("true");
    bars = sales.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(31);
    // Month view covers every calendar day and drops the per-bar peso labels
    // so a dense month stays legible.
    expect(labels()[0]).toBe("Thu");
    expect(labels()[30]).toBe("Sat");
    expect(sales.querySelectorAll("[data-value]")).toHaveLength(0);
  });

  it("shows the payment split donut with Cash and GCash percentages for each period", async () => {
    stubDashboard();
    renderDashboard();

    const split = await screen.findByRole("region", { name: "Payment split" });
    const controls = within(split).getByRole("group", {
      name: "Payment split period",
    });
    const today = within(controls).getByRole("button", { name: "Today" });
    const week = within(controls).getByRole("button", { name: "Week" });
    const month = within(controls).getByRole("button", { name: "Month" });
    expect(month.getAttribute("aria-pressed")).toBe("true");

    const cashRow = () =>
      within(split).getByText("Cash").closest("li") as HTMLElement;
    const gcashRow = () =>
      within(split).getByText("GCash").closest("li") as HTMLElement;

    // Defaults to the month: 30000 cash / 40000 total = 75%.
    expect(cashRow().textContent).toContain("₱300");
    expect(cashRow().textContent).toContain("75%");
    expect(gcashRow().textContent).toContain("₱100");
    expect(gcashRow().textContent).toContain("25%");
    expect(within(split).getByText("₱400")).toBeDefined();

    fireEvent.click(today);
    expect(today.getAttribute("aria-pressed")).toBe("true");
    // 10000 cash / 13800 total = 72%; 3800 gcash / 13800 = 28%.
    expect(cashRow().textContent).toContain("₱100");
    expect(cashRow().textContent).toContain("72%");
    expect(gcashRow().textContent).toContain("₱38");
    expect(gcashRow().textContent).toContain("28%");
    expect(within(split).getByText("₱138")).toBeDefined();

    fireEvent.click(week);
    expect(week.getAttribute("aria-pressed")).toBe("true");
    // Calendar-week fixture: 20000 cash / 25000 total = 80%; 5000 gcash = 20%.
    expect(cashRow().textContent).toContain("₱200");
    expect(cashRow().textContent).toContain("80%");
    expect(gcashRow().textContent).toContain("₱50");
    expect(gcashRow().textContent).toContain("20%");
    expect(within(split).getByText("₱250")).toBeDefined();
  });

  it("shows loan dues with days_until badges in Upcoming dues", async () => {
    stubDashboard();
    renderDashboard();

    const dues = await screen.findByRole("region", { name: "Upcoming dues" });

    // Overdue keeps the danger badge and amount.
    const overdueRow = within(dues)
      .getByText("Rice supplier")
      .closest("li") as HTMLElement;
    expect(within(overdueRow).getByText("Overdue").className).toContain(
      "text-danger",
    );
    expect(within(overdueRow).getByText("₱400").className).toContain(
      "text-danger",
    );
    expect(overdueRow.textContent).toContain("due 2026-10-10");

    const todayRow = within(dues)
      .getByText("Milk supplier")
      .closest("li") as HTMLElement;
    expect(within(todayRow).getByText("Due today")).toBeDefined();

    // Loans join the list with the installment amount and full due date.
    const loanRow = within(dues).getByText("BDO").closest("li") as HTMLElement;
    expect(within(loanRow).getByText("Loan")).toBeDefined();
    expect(within(loanRow).getByText("₱100")).toBeDefined();
    expect(within(loanRow).getByText("Due in 1 day")).toBeDefined();
    expect(loanRow.textContent).toContain("due 2026-10-15");

    // A future bill gets the plural countdown, a plain amount, no Overdue.
    const billRow = within(dues).getByText("Meralco").closest("li") as HTMLElement;
    expect(within(billRow).getByText("Due in 6 days")).toBeDefined();
    expect(within(billRow).queryByText("Overdue")).toBeNull();
    expect(within(billRow).getByText("₱2500").className).not.toContain(
      "text-danger",
    );
    expect(billRow.textContent).toContain("due 2026-10-20");
  });

  it("shows the loans summary total, count, and an Open link to finance", async () => {
    stubDashboard();
    renderDashboard();

    const loans = await screen.findByRole("region", { name: "Loans" });
    expect(within(loans).getByText("₱900")).toBeDefined();
    expect(within(loans).getByText("1 outstanding")).toBeDefined();
    expect(
      within(loans).getByRole("link", { name: "Open" }).getAttribute("href"),
    ).toBe("/finance/loans");
  });

  it("ranks best sellers by quantity and toggles Week/Month", async () => {
    stubDashboard();
    renderDashboard();

    const sellers = await screen.findByRole("region", { name: "Best sellers" });
    const controls = within(sellers).getByRole("group", {
      name: "Best sellers period",
    });
    const week = within(controls).getByRole("button", { name: "Week" });
    const month = within(controls).getByRole("button", { name: "Month" });
    expect(month.getAttribute("aria-pressed")).toBe("true");

    const labels = () =>
      [...sellers.querySelectorAll("[data-label]")].map(
        (node) => node.textContent,
      );
    const values = () =>
      [...sellers.querySelectorAll("[data-value]")].map(
        (node) => node.textContent,
      );

    expect(labels()).toEqual(["Adobo · ₱100", "Halo-halo · ₱160"]);
    expect(values()).toEqual(["10 sold", "8 sold"]);
    expect(
      (sellers.querySelectorAll("[data-bar]")[0] as HTMLElement).style.width,
    ).toBe("100%");

    fireEvent.click(week);
    expect(week.getAttribute("aria-pressed")).toBe("true");
    // Week: Halo-halo (4) outranks Adobo (2).
    expect(labels()).toEqual(["Halo-halo · ₱80", "Adobo · ₱20"]);
    expect(values()).toEqual(["4 sold", "2 sold"]);
  });

  it("renders empty states for a fresh day instead of blanks or NaN", async () => {
    stubDashboard({
      ...dashboard,
      income_day: { cash_cents: 0, gcash_cents: 0, total_cents: 0, count: 0 },
      income_week: { cash_cents: 0, gcash_cents: 0, total_cents: 0, count: 0 },
      income_month: { cash_cents: 0, gcash_cents: 0, total_cents: 0, count: 0 },
      money_out_month_cents: 0,
      net_month_cents: 0,
      sales_by_day_week: WEEK_SALES.map((day) => ({ ...day, total_cents: 0 })),
      sales_by_day_month: MONTH_SALES.map((day) => ({ ...day, total_cents: 0 })),
      upcoming_dues: [],
      best_sellers_week: [],
      best_sellers_month: [],
    });
    renderDashboard();

    expect(await screen.findByText("Nothing due right now.")).toBeDefined();
    expect(screen.getByText("No sales this week.")).toBeDefined();
    expect(screen.getByText("No payments this month.")).toBeDefined();
    expect(screen.getByText("No sales this month.")).toBeDefined();
    // Zero money still renders as ₱0, never NaN or a blank chip.
    expect(within(chip("Average/day")).getByText("₱0")).toBeDefined();
  });

  it("preserves the loading and error/retry state", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as typeof fetch;

    renderDashboard();

    expect(
      await screen.findByText("Could not load the dashboard."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });
});
