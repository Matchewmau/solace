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
import FinanceExpensesPage from "./FinanceExpensesPage";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Expense } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const expenses: Expense[] = [
  {
    id: 1,
    date: "2026-10-12",
    category: "Beans",
    amount_cents: 120000,
    note: "Arla 6L",
  },
  { id: 2, date: "2026-10-01", category: "Milk", amount_cents: 25000, note: "" },
];

const posted: Array<{ url: string; body: unknown }> = [];

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubFetch() {
  posted.length = 0;
  setStoredAuth("solace123");
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/expenses" && (!init || init.method === undefined)) {
      return ok(expenses.map((expense) => ({ ...expense })));
    }
    if (u === "/api/expenses" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url: u, body });
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
        <FinanceExpensesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Body rows (header row excluded), in DOM order, as their visible text. */
function bodyRowText(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

describe("FinanceExpensesPage", () => {
  it("renders sortable Date and Amount columns and the ledger rows", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole("table", { name: "Expenses" })).toBeDefined();
    expect(
      screen.getByRole("columnheader", { name: "Date" }).getAttribute("aria-sort"),
    ).toBe("none");
    expect(
      screen
        .getByRole("columnheader", { name: "Amount" })
        .getAttribute("aria-sort"),
    ).toBe("none");
    // Non-sortable columns carry no sort control.
    expect(
      screen.getByRole("columnheader", { name: "Category" }).getAttribute("aria-sort"),
    ).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Note" }).getAttribute("aria-sort"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(bodyRowText()[0]).toContain("Beans");
    expect(bodyRowText()[1]).toContain("Milk");
  });

  it("+ Add expense opens the dialog and submits postExpense", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Beans");

    fireEvent.click(screen.getByRole("button", { name: "+ Add expense" }));
    const dialog = screen.getByRole("dialog", { name: "Add expense" });
    const form = within(dialog).getByLabelText(
      "Add expense form",
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

  it("uses the shared field style in the add form", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Beans");
    fireEvent.click(screen.getByRole("button", { name: "+ Add expense" }));
    const amount = screen.getByLabelText("Expense amount in pesos");
    expect(amount.className).toContain("field");
  });
});
