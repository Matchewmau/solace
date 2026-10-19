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

/** 14 days, oldest → newest, ending on the fixture date; totals climb 1000…14000. */
const SALES_BY_DAY = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-10-${String(index + 1).padStart(2, "0")}`,
  total_cents: (index + 1) * 1000,
}));

// Net math: day 13800 − 4000 = 9800; month 40000 − 10000 = 30000.
const dashboard: Dashboard = {
  date: "2026-10-14",
  month: "2026-10",
  income_day: { cash_cents: 10000, gcash_cents: 3800, total_cents: 13800, count: 2 },
  income_month: {
    cash_cents: 30000,
    gcash_cents: 10000,
    total_cents: 40000,
    count: 5,
  },
  expenses_day_cents: 4000,
  expenses_month_cents: 5000,
  money_out_day_cents: 4000,
  money_out_month_cents: 10000,
  money_out_month_by_kind: {
    bills_cents: 4000,
    expenses_cents: 5000,
    payables_cents: 1000,
    loans_cents: 0,
    salaries_cents: 0,
  },
  sales_by_day: SALES_BY_DAY,
  net_day_cents: 9800,
  net_month_cents: 30000,
  unpaid_bills_cents: 300000,
  unpaid_bills_count: 2,
  unpaid_payables_cents: 100000,
  unpaid_payables_count: 3,
  overdue_payables_count: 1,
  expenses_month_count: 2,
  outstanding_loans_cents: 90000,
  outstanding_loans_count: 1,
  upcoming_dues: [
    { kind: "bill", label: "Meralco", amount_cents: 250000, due: "05" },
    {
      kind: "payable",
      label: "Rice supplier",
      amount_cents: 40000,
      due: "2026-10-01",
      overdue: true,
    },
  ],
  loans: [{ id: 1, lender: "BDO", balance_cents: 90000 }],
  // Deliberately unsorted: the page must rank best sellers by qty.
  best_sellers: [
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
  it("renders the six day/month stat chips with the net math", async () => {
    stubDashboard();
    renderDashboard();

    // Net rule: income − money out, displayed for both day and month.
    expect(await screen.findByText("Day in")).toBeDefined();
    expect(within(chip("Day in")).getByText("₱138")).toBeDefined();
    expect(within(chip("Day out")).getByText("₱40")).toBeDefined();
    const dayNet = within(chip("Day net")).getByText("₱98");
    expect(dayNet.className).toContain("text-ok");

    expect(within(chip("Month in")).getByText("₱400")).toBeDefined();
    expect(within(chip("Month out")).getByText("₱100")).toBeDefined();
    const monthNet = within(chip("Month net")).getByText("₱300");
    expect(monthNet.className).toContain("text-ok");

    // The subtitle states the net rule and keeps stocks separate.
    expect(screen.getByText(/money in minus money out/i)).toBeDefined();
    expect(screen.getByText(/stocks, listed separately/i)).toBeDefined();
  });

  it("tones a negative day and month net as danger", async () => {
    stubDashboard({ ...dashboard, net_day_cents: -1500, net_month_cents: -2000 });
    renderDashboard();

    expect(await screen.findByText("Day net")).toBeDefined();
    expect(within(chip("Day net")).getByText("₱-15").className).toContain(
      "text-danger",
    );
    expect(within(chip("Month net")).getByText("₱-20").className).toContain(
      "text-danger",
    );
  });

  it("draws the 14-day sales chart as one bar per day, oldest first", async () => {
    stubDashboard();
    renderDashboard();

    const sales = await screen.findByRole("region", {
      name: "Sales · last 14 days",
    });
    const bars = sales.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(14);

    const labels = [...sales.querySelectorAll("[data-label]")].map(
      (node) => node.textContent,
    );
    expect(labels[0]).toBe("01");
    expect(labels[6]).toBe("07");
    expect(labels[13]).toBe("14");

    // The peak day fills the column; the smallest is a proportional sliver.
    expect((bars[13] as HTMLElement).style.height).toBe("100%");
    expect((bars[0] as HTMLElement).style.height).not.toBe("100%");
  });

  it("shows the month payment split donut with Cash and GCash percentages", async () => {
    stubDashboard();
    renderDashboard();

    const split = await screen.findByRole("region", { name: "Payment split" });
    expect(within(split).getByText("Cash")).toBeDefined();
    expect(within(split).getByText("GCash")).toBeDefined();

    const cash = within(split).getByText("Cash").closest("li") as HTMLElement;
    expect(cash.textContent).toContain("₱300");
    expect(cash.textContent).toContain("75%");

    const gcash = within(split).getByText("GCash").closest("li") as HTMLElement;
    expect(gcash.textContent).toContain("₱100");
    expect(gcash.textContent).toContain("25%");
  });

  it("marks only overdue payables with the red badge and amount", async () => {
    stubDashboard();
    renderDashboard();

    const dues = await screen.findByRole("region", { name: "Upcoming dues" });

    const overdueRow = within(dues)
      .getByText("Rice supplier")
      .closest("li") as HTMLElement;
    expect(within(overdueRow).getByText("Overdue").className).toContain(
      "text-danger",
    );
    expect(within(overdueRow).getByText("₱400").className).toContain(
      "text-danger",
    );
    expect(overdueRow.textContent).toContain("due 2026-10-01");

    // A not-overdue bill shows no badge and a plain amount.
    const billRow = within(dues).getByText("Meralco").closest("li") as HTMLElement;
    expect(within(billRow).queryByText("Overdue")).toBeNull();
    expect(within(billRow).getByText("₱2500").className).not.toContain(
      "text-danger",
    );
    expect(billRow.textContent).toContain("due 05");
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

  it("ranks best sellers by quantity with horizontal bars", async () => {
    stubDashboard();
    renderDashboard();

    const sellers = await screen.findByRole("region", { name: "Best sellers" });
    const rows = sellers.querySelectorAll("[data-row]");
    expect(rows.length).toBe(2);

    // Adobo (qty 10) outranks Halo-halo (qty 8) even though it comes second.
    const labels = [...sellers.querySelectorAll("[data-label]")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Adobo · ₱100", "Halo-halo · ₱160"]);
    const values = [...sellers.querySelectorAll("[data-value]")].map(
      (node) => node.textContent,
    );
    expect(values).toEqual(["10 sold", "8 sold"]);
    expect(
      (sellers.querySelectorAll("[data-bar]")[0] as HTMLElement).style.width,
    ).toBe("100%");
  });

  it("renders empty states for a fresh day instead of blanks or NaN", async () => {
    stubDashboard({
      ...dashboard,
      income_day: { cash_cents: 0, gcash_cents: 0, total_cents: 0, count: 0 },
      income_month: { cash_cents: 0, gcash_cents: 0, total_cents: 0, count: 0 },
      money_out_day_cents: 0,
      money_out_month_cents: 0,
      net_day_cents: 0,
      net_month_cents: 0,
      sales_by_day: SALES_BY_DAY.map((day) => ({ ...day, total_cents: 0 })),
      upcoming_dues: [],
      best_sellers: [],
    });
    renderDashboard();

    expect(await screen.findByText("Nothing due right now.")).toBeDefined();
    expect(screen.getByText("No sales in the last 14 days.")).toBeDefined();
    expect(screen.getByText("No payments this month.")).toBeDefined();
    expect(screen.getByText("No sales this month.")).toBeDefined();
    // Zero money still renders as ₱0, never NaN or a blank chip.
    expect(within(chip("Day net")).getByText("₱0")).toBeDefined();
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
