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
import FinanceBillsPage from "./FinanceBillsPage";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Bill } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const bills: Bill[] = [
  { id: 1, name: "Meralco", amount_cents: 250000, due_day: 15, paid: 0 },
  { id: 2, name: "Rent", amount_cents: 600000, due_day: 1, paid: 1 },
];

const patched: Array<{ url: string; body: unknown }> = [];
const created: Array<{ url: string; body: unknown; headers: unknown }> = [];

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubFetch() {
  patched.length = 0;
  created.length = 0;
  setStoredAuth("solace123");
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/bills" && (!init || init.method === undefined)) {
      return ok(bills.map((bill) => ({ ...bill })));
    }
    const billMatch = u.match(/^\/api\/bills\/(\d+)$/);
    if (billMatch && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { paid: 0 | 1 };
      patched.push({ url: u, body });
      const bill = bills.find((b) => b.id === Number(billMatch[1]));
      return ok({ ...bill, ...body });
    }
    if (u === "/api/bills" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created.push({ url: u, body, headers: init.headers });
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
        <FinanceBillsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FinanceBillsPage", () => {
  it("renders the bills table with a back link and paid/unpaid status", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole("table", { name: "Bills" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Back to finance" }).getAttribute("href"),
    ).toBe("/finance");

    const unpaidRow = screen.getByText("Meralco").closest("tr") as HTMLElement;
    expect(within(unpaidRow).getByText("Unpaid")).toBeDefined();

    const paidRow = screen.getByText("Rent").closest("tr") as HTMLElement;
    expect(within(paidRow).getByText("Paid", { selector: "span" })).toBeDefined();
  });

  it("Mark paid toggles bill 1 via patchBillPaid(1, 1)", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Meralco");

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle paid for Meralco" }),
    );

    await vi.waitFor(() => {
      expect(patched).toHaveLength(1);
    });
    expect(patched[0]).toEqual({ url: "/api/bills/1", body: { paid: 1 } });
  });

  it("+ Add bill opens the dialog and submits postBill", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Meralco");

    fireEvent.click(screen.getByRole("button", { name: "+ Add bill" }));
    const dialog = screen.getByRole("dialog", { name: "Add bill" });
    const form = within(dialog).getByLabelText(
      "Add bill form",
    ) as HTMLFormElement;

    fireEvent.change(form.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: "Water" },
    });
    fireEvent.change(
      form.querySelector('input[name="amount"]') as HTMLInputElement,
      { target: { value: "150" } },
    );
    fireEvent.change(
      form.querySelector('input[name="due_day"]') as HTMLInputElement,
      { target: { value: "5" } },
    );
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0].url).toBe("/api/bills");
    expect(created[0].body).toEqual({
      name: "Water",
      amount_cents: 15000,
      due_day: 5,
    });
  });
});
