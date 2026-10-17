import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinanceLoansPage from "./FinanceLoansPage";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Loan } from "../api/finance";

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
    installment_cents: 50000,
    due_day: 15,
  },
  {
    id: 2,
    lender: "Settled Lender",
    principal_cents: 50000,
    balance_cents: 0,
    installment_cents: 5000,
    due_day: 5,
  },
];

const paymentsPosted: Array<{ url: string; body: unknown }> = [];
const created: Array<{ url: string; body: unknown }> = [];

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubFetch() {
  paymentsPosted.length = 0;
  created.length = 0;
  setStoredAuth("solace123");
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/loans" && (!init || init.method === undefined)) {
      return ok(loans.map((loan) => ({ ...loan })));
    }
    const paymentsMatch = u.match(/^\/api\/loans\/(\d+)\/payments$/);
    if (paymentsMatch && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { amount_cents: number };
      paymentsPosted.push({ url: u, body });
      return ok(
        {
          payment: {
            id: 9,
            loan_id: Number(paymentsMatch[1]),
            amount_cents: body.amount_cents,
            paid_at: "2026-10-13 10:00:00",
          },
          balance_cents: 40000,
        },
        201,
      );
    }
    if (u === "/api/loans" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created.push({ url: u, body });
      return ok({ id: 99, ...body }, 201);
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FinanceLoansPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FinanceLoansPage", () => {
  it("shows the Outstanding/Paid badges per balance", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    const owingRow = screen.getByText("BDO").closest("tr") as HTMLElement;
    expect(within(owingRow).getByText("Outstanding").className).toContain(
      "text-danger",
    );

    const settledRow = screen
      .getByText("Settled Lender")
      .closest("tr") as HTMLElement;
    expect(within(settledRow).getByText("Paid").className).toContain("text-ok");
  });

  it("pay dialog prefills the installment and submits postLoanPayment(1, 50000)", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByRole("button", { name: "Pay BDO" }));
    const dialog = screen.getByRole("dialog", { name: "Pay BDO" });
    const amount = within(dialog).getByLabelText(
      "Payment amount in pesos",
    ) as HTMLInputElement;
    // Prefilled with the installment: ₱500 = 50000 cents.
    expect(amount.value).toBe("500");

    fireEvent.submit(within(dialog).getByLabelText("Pay loan form"));

    await vi.waitFor(() => {
      expect(paymentsPosted).toHaveLength(1);
    });
    expect(paymentsPosted[0]).toEqual({
      url: "/api/loans/1/payments",
      body: { amount_cents: 50000 },
    });
  });

  it("History links to the dedicated loan history route", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    expect(
      screen
        .getByRole("link", { name: "View history for BDO" })
        .getAttribute("href"),
    ).toBe("/finance/history?loan=1");
  });

  it("+ Add loan opens the dialog and submits postLoan", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByRole("button", { name: "+ Add loan" }));
    const dialog = screen.getByRole("dialog", { name: "Add loan" });
    const form = within(dialog).getByLabelText("Add loan form") as HTMLFormElement;

    fireEvent.change(
      form.querySelector('input[name="lender"]') as HTMLInputElement,
      { target: { value: "BPI" } },
    );
    fireEvent.change(
      form.querySelector('input[name="principal"]') as HTMLInputElement,
      { target: { value: "1000" } },
    );
    fireEvent.change(
      form.querySelector('input[name="installment"]') as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      form.querySelector('input[name="due_day"]') as HTMLInputElement,
      { target: { value: "15" } },
    );
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0]).toEqual({
      url: "/api/loans",
      body: {
        lender: "BPI",
        principal_cents: 100000,
        installment_cents: 10000,
        due_day: 15,
      },
    });
  });
});
