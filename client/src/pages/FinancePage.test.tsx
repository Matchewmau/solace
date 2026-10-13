import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinancePage from "./FinancePage";
import { isOverdue } from "../api/finance";
import type { Bill, Expense, Payable } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
