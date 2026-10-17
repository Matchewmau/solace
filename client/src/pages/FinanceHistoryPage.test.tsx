import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "../components/AuthProvider";
import { routes } from "../routes";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Loan, LoanPayment } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const loans: Loan[] = [
  {
    id: 1,
    lender: "BDO",
    principal_cents: 100000,
    balance_cents: 90000,
    installment_cents: 10000,
    due_day: 15,
  },
];

const payments: LoanPayment[] = [
  { id: 1, loan_id: 1, amount_cents: 10000, paid_at: "2026-10-12 10:00:00" },
  { id: 2, loan_id: 1, amount_cents: 8050, paid_at: "2026-10-13 11:30:00" },
];

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubFetch() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/bills" && (!init || init.method === undefined)) return ok([]);
    if (u === "/api/expenses" && (!init || init.method === undefined)) return ok([]);
    if (u === "/api/payables" && (!init || init.method === undefined)) return ok([]);
    if (u === "/api/loans" && (!init || init.method === undefined)) {
      return ok(loans.map((loan) => ({ ...loan })));
    }
    const historyMatch = u.match(/^\/api\/loans\/(\d+)\/payments$/);
    if (historyMatch && (!init || init.method === undefined)) {
      const loanId = Number(historyMatch[1]);
      if (loanId === 999) {
        return ok({ error: "loan not found" }, 404);
      }
      return ok(payments.filter((p) => p.loan_id === loanId));
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("FinanceHistoryPage (own route)", () => {
  it("GET /finance/history?loan=1 renders a table of loan payments (amount, paid date)", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/finance/history?loan=1");

    const table = await screen.findByRole("table", { name: "Payment history" });
    expect(table.textContent).toContain("₱100");
    expect(table.textContent).toContain("2026-10-12 10:00:00");
    expect(
      screen.getByRole("columnheader", { name: "Amount" }),
    ).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: "Paid at" }),
    ).toBeDefined();

    // Amount cells render through formatPeso (whole pesos + fractional).
    const amounts = Array.from(
      table.querySelectorAll('td[data-label="Amount"]'),
    ).map((cell) => cell.textContent);
    expect(amounts).toEqual(["₱100", "₱80.50"]);

    // Every body cell carries its column label for the phone row-card layout.
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      expect(
        Array.from(row.querySelectorAll("td")).map((cell) =>
          cell.getAttribute("data-label"),
        ),
      ).toEqual(["Amount", "Paid at"]);
    }

    // Both columns are sortable, so their headers are buttons.
    expect(screen.getByRole("button", { name: "Amount" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Paid at" })).toBeDefined();
  });

  it("unknown loan id shows an error, not a table", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/finance/history?loan=999");

    expect(await screen.findByText("Could not load history.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("missing ?loan= shows an error, not a table", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/finance/history");

    expect(await screen.findByText("Unknown loan.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("finance history link navigates to that route (Pay stays inline, no back link)", async () => {
    setStoredAuth("solace123");
    stubFetch();
    // The loan row (and its History link) lives on the /finance/loans drill-in
    // now that FinancePage is the money dashboard.
    renderAt("/finance/loans");
    // /finance/loans is a lazy route chunk: allow time for the import.
    await screen.findByText("BDO", {}, { timeout: 5000 });

    // Pay stays on the row as its own inline affordance.
    expect(screen.getByLabelText("Pay BDO")).toBeDefined();
    fireEvent.click(screen.getByRole("link", { name: "View history for BDO" }));

    // Navigation lands on the dedicated history route with a real table.
    await screen.findByText("Loan history", {}, { timeout: 5000 });
    const table = await screen.findByRole("table", {}, { timeout: 5000 });
    expect(table.textContent).toContain("₱100");
    // No back link: the global rail owns the way back to /finance.
    expect(screen.queryByRole("link", { name: "Back to finance" })).toBeNull();
    expect(
      screen.getByRole("navigation", { name: "Pages" }),
    ).toBeDefined();
  });

  it("renders inside the authed layout (global rail present)", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/finance/history?loan=1");

    await screen.findByRole("table");
    expect(
      screen.getByRole("navigation", { name: "Pages" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Log out" }),
    ).toBeDefined();
  });
});
