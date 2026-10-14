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

    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("₱100");
    expect(table.textContent).toContain("2026-10-12 10:00:00");
    expect(
      screen.getByRole("columnheader", { name: "Amount" }),
    ).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: "Paid at" }),
    ).toBeDefined();
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

  it("finance history link navigates to that route (Pay stays inline)", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/finance");
    // /finance is a lazy route chunk: allow time for the import to resolve.
    await screen.findByText("BDO", {}, { timeout: 5000 });

    // Pay stays on the row as its own inline affordance.
    expect(screen.getByLabelText("Pay BDO")).toBeDefined();
    fireEvent.click(screen.getByRole("link", { name: "View history for BDO" }));

    // Navigation lands on the dedicated history route with a real table.
    const table = await screen.findByRole("table", {}, { timeout: 5000 });
    expect(table.textContent).toContain("₱100");
    expect(
      screen.getByRole("link", { name: "Back to finance" }),
    ).toBeDefined();
  });

  it("renders inside the authed layout (back button present)", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/finance/history?loan=1");

    await screen.findByRole("table");
    expect(
      screen.getByRole("link", { name: "Back to dashboard" }),
    ).toBeDefined();
  });
});
