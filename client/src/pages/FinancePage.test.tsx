import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinancePage from "./FinancePage";
import { isOverdue } from "../api/finance";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Bill, Expense, Loan, LoanPayment, Payable } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const bills: Bill[] = [
  { id: 1, name: "Meralco", amount_cents: 250000, due_day: 15, paid: 0 },
];

const expenses: Expense[] = [
  {
    id: 1,
    date: "2026-10-12",
    category: "Beans",
    amount_cents: 120000,
    note: "",
  },
];

const payables: Payable[] = [
  {
    id: 1,
    label: "Overdue Supplier",
    amount_cents: 80000,
    due_date: "2000-01-01",
    paid: 0,
  },
  {
    id: 2,
    label: "Future Supplier",
    amount_cents: 50000,
    due_date: "2999-01-01",
    paid: 0,
  },
  {
    id: 3,
    label: "Settled Supplier",
    amount_cents: 30000,
    due_date: "2000-01-01",
    paid: 1,
  },
];

const posted: Array<{ url: string; body: unknown }> = [];
const patched: Array<{ url: string; body: unknown }> = [];
const loanPaymentsPosted: Array<{ url: string; body: unknown }> = [];

const loans: Loan[] = [
  {
    id: 1,
    lender: "BDO",
    principal_cents: 100000,
    balance_cents: 90000,
    installment_cents: 10000,
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

const loanPayments: LoanPayment[] = [
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
  posted.length = 0;
  patched.length = 0;
  loanPaymentsPosted.length = 0;
  // Reset shared loan fixtures between tests.
  loans[0] = {
    id: 1,
    lender: "BDO",
    principal_cents: 100000,
    balance_cents: 90000,
    installment_cents: 10000,
    due_day: 15,
  };
  loanPayments.length = 0;
  loanPayments.push({
    id: 1,
    loan_id: 1,
    amount_cents: 10000,
    paid_at: "2026-10-12 10:00:00",
  });
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/bills" && (!init || init.method === undefined)) {
      return ok(bills);
    }
    if (u === "/api/expenses" && (!init || init.method === undefined)) {
      return ok(expenses);
    }
    if (u === "/api/payables" && (!init || init.method === undefined)) {
      return ok(payables);
    }
    if (u === "/api/loans" && (!init || init.method === undefined)) {
      return ok(loans.map((loan) => ({ ...loan })));
    }
    const historyMatch = u.match(/^\/api\/loans\/(\d+)\/payments$/);
    if (historyMatch && (!init || init.method === undefined)) {
      const loanId = Number(historyMatch[1]);
      return ok(
        loanPayments
          .filter((payment) => payment.loan_id === loanId)
          .map((payment) => ({ ...payment })),
      );
    }
    if (historyMatch && init?.method === "POST") {
      const loanId = Number(historyMatch[1]);
      const body = JSON.parse(String(init.body)) as {
        amount_cents: number;
      };
      loanPaymentsPosted.push({ url: u, body });
      const loan = loans.find((candidate) => candidate.id === loanId);
      if (!loan) {
        return ok({ error: "loan not found" }, 404);
      }
      loan.balance_cents -= body.amount_cents;
      const payment = {
        id: Math.max(...loanPayments.map((p) => p.id)) + 1,
        loan_id: loanId,
        amount_cents: body.amount_cents,
        paid_at: "2026-10-13 10:00:00",
      };
      loanPayments.unshift(payment);
      return ok(
        { payment: { ...payment }, balance_cents: loan.balance_cents },
        201,
      );
    }
    if (u === "/api/expenses" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url: u, body });
      return ok({ id: 99, ...body }, 201);
    }
    const billMatch = u.match(/^\/api\/bills\/(\d+)$/);
    if (billMatch && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { paid: 0 | 1 };
      patched.push({ url: u, body });
      const bill = bills.find((b) => b.id === Number(billMatch[1]));
      return ok({ ...bill, ...body });
    }
    const payableMatch = u.match(/^\/api\/payables\/(\d+)$/);
    if (payableMatch && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { paid: 0 | 1 };
      patched.push({ url: u, body });
      const payable = payables.find((p) => p.id === Number(payableMatch[1]));
      return ok({ ...payable, ...body });
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderFinance() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FinancePage />
    </QueryClientProvider>,
  );
}

describe("isOverdue (pure)", () => {
  it("flags unpaid past-due rows only, against the UTC-today ruling", () => {
    expect(
      isOverdue({ due_date: "2000-01-01", paid: 0 }, "2026-10-13"),
    ).toBe(true);
    expect(
      isOverdue({ due_date: "2026-10-13", paid: 0 }, "2026-10-13"),
    ).toBe(false);
    expect(
      isOverdue({ due_date: "2999-01-01", paid: 0 }, "2026-10-13"),
    ).toBe(false);
    expect(
      isOverdue({ due_date: "2000-01-01", paid: 1 }, "2026-10-13"),
    ).toBe(false);
  });
});

describe("FinancePage with mocked data", () => {
  it("shows the OVERDUE badge on the unpaid past-due payable only", async () => {
    stubFetch();
    renderFinance();
    await screen.findByText("Overdue Supplier");

    const overdueRow = screen
      .getByText("Overdue Supplier")
      .closest("li") as HTMLElement;
    expect(overdueRow.textContent).toContain("OVERDUE");

    const futureRow = screen
      .getByText("Future Supplier")
      .closest("li") as HTMLElement;
    expect(futureRow.textContent).not.toContain("OVERDUE");

    const settledRow = screen
      .getByText("Settled Supplier")
      .closest("li") as HTMLElement;
    expect(settledRow.textContent).not.toContain("OVERDUE");
  });

  it("paid toggle PATCHes the bill and the payable", async () => {
    stubFetch();
    renderFinance();
    await screen.findByText("Meralco");

    fireEvent.click(screen.getByLabelText("Toggle paid for Meralco"));
    await vi.waitFor(() => {
      expect(patched).toHaveLength(1);
    });
    expect(patched[0]).toEqual({
      url: "/api/bills/1",
      body: { paid: 1 },
    });

    fireEvent.click(screen.getByLabelText("Toggle paid for Future Supplier"));
    await vi.waitFor(() => {
      expect(patched).toHaveLength(2);
    });
    expect(patched[1]).toEqual({
      url: "/api/payables/2",
      body: { paid: 1 },
    });
  });

  it("add-expense form POSTs date, category, amount_cents, and note", async () => {
    stubFetch();
    renderFinance();
    await screen.findByText("Meralco");

    const form = screen.getByLabelText("Add expense").closest(
      "form",
    ) as HTMLFormElement;
    fireEvent.change(form.querySelector('input[name="date"]') as HTMLInputElement, {
      target: { value: "2026-10-13" },
    });
    fireEvent.change(
      form.querySelector('input[name="category"]') as HTMLInputElement,
      { target: { value: "Milk" } },
    );
    fireEvent.change(
      form.querySelector('input[name="amount"]') as HTMLInputElement,
      { target: { value: "250" } },
    );
    fireEvent.change(form.querySelector('input[name="note"]') as HTMLInputElement, {
      target: { value: "Arla 6L" },
    });
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toEqual({
      url: "/api/expenses",
      body: {
        date: "2026-10-13",
        category: "Milk",
        amount_cents: 25000,
        note: "Arla 6L",
      },
    });
  });
});

describe("FinancePage loans (Task 12)", () => {
  it("shows OUTSTANDING/PAID badges per loan balance", async () => {
    stubFetch();
    renderFinance();
    await screen.findByText("BDO");

    const owingRow = screen.getByText("BDO").closest("li") as HTMLElement;
    expect(owingRow.textContent).toContain("OUTSTANDING");
    expect(owingRow.textContent).not.toContain("PAID");

    const settledRow = screen
      .getByText("Settled Lender")
      .closest("li") as HTMLElement;
    expect(settledRow.textContent).toContain("PAID");
  });

  it("pay form POSTs amount_cents and the PAID badge appears at zero balance", async () => {
    stubFetch();
    renderFinance();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByLabelText("View payments for BDO"));
    const form = screen.getByLabelText("Pay loan").closest(
      "form",
    ) as HTMLFormElement;
    const amount = form.querySelector(
      'input[name="amount"]',
    ) as HTMLInputElement;
    // Amount defaults to the installment (₱100 = 10000 cents).
    expect(amount.value).toBe("100");

    fireEvent.change(amount, { target: { value: "900" } });
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(loanPaymentsPosted).toHaveLength(1);
    });
    expect(loanPaymentsPosted[0]).toEqual({
      url: "/api/loans/1/payments",
      body: { amount_cents: 90000 },
    });

    // Balance refreshes from the refetched loans list: 90000 - 90000 = 0.
    const owingRow = screen.getByText("BDO").closest("li") as HTMLElement;
    await vi.waitFor(() => {
      expect(owingRow.textContent).toContain("PAID");
    });
  });

  it("shows payment history for the selected loan", async () => {
    stubFetch();
    renderFinance();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByLabelText("View payments for BDO"));
    const history = await screen.findByLabelText("Payment history");
    expect(history.textContent).toContain("2026-10-12 10:00:00");
  });
});

describe("FinancePage create forms (review fix wave)", () => {
  const created: Array<{ url: string; body: unknown; headers: unknown }> = [];

  function stubCreate() {
    created.length = 0;
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (
        (u === "/api/bills" ||
          u === "/api/expenses" ||
          u === "/api/payables" ||
          u === "/api/loans") &&
        (!init || init.method === undefined)
      ) {
        return ok([]);
      }
      if (
        (u === "/api/bills" ||
          u === "/api/payables" ||
          u === "/api/loans") &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        created.push({ url: u, body, headers: init.headers });
        return ok({ id: 99, ...body }, 201);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
  }

  it("add-bill form POSTs name/amount_cents/due_day with the auth header", async () => {
    stubCreate();
    renderFinance();
    await screen.findByText("Bills");

    const form = screen.getByLabelText("Add bill").closest(
      "form",
    ) as HTMLFormElement;
    fireEvent.change(form.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: "Meralco" },
    });
    fireEvent.change(
      form.querySelector('input[name="amount"]') as HTMLInputElement,
      { target: { value: "250" } },
    );
    fireEvent.change(
      form.querySelector('input[name="due_day"]') as HTMLInputElement,
      { target: { value: "15" } },
    );
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0].url).toBe("/api/bills");
    expect(created[0].body).toEqual({
      name: "Meralco",
      amount_cents: 25000,
      due_day: 15,
    });
    expect(created[0].headers).toMatchObject({ "x-solace-auth": "solace123" });
  });

  it("add-payable form POSTs label/amount_cents/due_date with the auth header", async () => {
    stubCreate();
    renderFinance();
    await screen.findByText("Payables");

    const form = screen.getByLabelText("Add payable").closest(
      "form",
    ) as HTMLFormElement;
    fireEvent.change(
      form.querySelector('input[name="label"]') as HTMLInputElement,
      { target: { value: "Supplier Ana" } },
    );
    fireEvent.change(
      form.querySelector('input[name="amount"]') as HTMLInputElement,
      { target: { value: "800" } },
    );
    fireEvent.change(
      form.querySelector('input[name="due_date"]') as HTMLInputElement,
      { target: { value: "2026-10-20" } },
    );
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0].url).toBe("/api/payables");
    expect(created[0].body).toEqual({
      label: "Supplier Ana",
      amount_cents: 80000,
      due_date: "2026-10-20",
    });
    expect(created[0].headers).toMatchObject({ "x-solace-auth": "solace123" });
  });

  it("add-loan form POSTs lender/principal/installment/due_day (no balance) with the auth header", async () => {
    stubCreate();
    renderFinance();
    await screen.findByText("Loans");

    const form = screen.getByLabelText("Add loan").closest(
      "form",
    ) as HTMLFormElement;
    fireEvent.change(
      form.querySelector('input[name="lender"]') as HTMLInputElement,
      { target: { value: "BDO" } },
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
    expect(created[0].url).toBe("/api/loans");
    expect(created[0].body).toEqual({
      lender: "BDO",
      principal_cents: 100000,
      installment_cents: 10000,
      due_day: 15,
    });
    expect(created[0].headers).toMatchObject({ "x-solace-auth": "solace123" });
  });
});
