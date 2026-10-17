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
import FinancePayablesPage from "./FinancePayablesPage";
import { utcToday } from "../api/finance";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Payable } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

/** UTC date `days` away from today, matching the server's overdue ruling. */
function shiftedDay(days: number): string {
  const date = new Date(`${utcToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const payables: Payable[] = [
  {
    id: 1,
    label: "Overdue Supplier",
    amount_cents: 80000,
    due_date: shiftedDay(-1),
    paid: 0,
  },
  {
    id: 2,
    label: "Future Supplier",
    amount_cents: 50000,
    due_date: shiftedDay(1),
    paid: 0,
  },
  {
    id: 3,
    label: "Settled Supplier",
    amount_cents: 30000,
    due_date: shiftedDay(-1),
    paid: 1,
  },
];

const patched: Array<{ url: string; body: unknown }> = [];
const created: Array<{ url: string; body: unknown }> = [];

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
    if (u === "/api/payables" && (!init || init.method === undefined)) {
      return ok(payables.map((payable) => ({ ...payable })));
    }
    const payableMatch = u.match(/^\/api\/payables\/(\d+)$/);
    if (payableMatch && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { paid: 0 | 1 };
      patched.push({ url: u, body });
      const payable = payables.find((p) => p.id === Number(payableMatch[1]));
      return ok({ ...payable, ...body });
    }
    if (u === "/api/payables" && init?.method === "POST") {
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
        <FinancePayablesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FinancePayablesPage", () => {
  it("shows the danger Overdue badge on the unpaid past-due payable only", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Overdue Supplier");

    const overdueRow = screen
      .getByText("Overdue Supplier")
      .closest("tr") as HTMLElement;
    const overdueBadge = within(overdueRow).getByText("Overdue");
    expect(overdueBadge.className).toContain("text-danger");

    const futureRow = screen
      .getByText("Future Supplier")
      .closest("tr") as HTMLElement;
    expect(within(futureRow).queryByText("Overdue")).toBeNull();
    expect(within(futureRow).getByText("Unpaid").className).toContain(
      "text-muted",
    );

    const settledRow = screen
      .getByText("Settled Supplier")
      .closest("tr") as HTMLElement;
    expect(within(settledRow).queryByText("Overdue")).toBeNull();
    expect(
      within(settledRow).getByText("Paid", { selector: "span" }).className,
    ).toContain("text-ok");
  });

  it("toggles a payable via patchPayablePaid", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Overdue Supplier");

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle paid for Future Supplier" }),
    );

    await vi.waitFor(() => {
      expect(patched).toHaveLength(1);
    });
    expect(patched[0]).toEqual({ url: "/api/payables/2", body: { paid: 1 } });
  });

  it("+ Add payable opens the dialog and submits postPayable", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Overdue Supplier");

    fireEvent.click(screen.getByRole("button", { name: "+ Add payable" }));
    const dialog = screen.getByRole("dialog", { name: "Add payable" });
    const form = within(dialog).getByLabelText(
      "Add payable form",
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
    expect(created[0]).toEqual({
      url: "/api/payables",
      body: {
        label: "Supplier Ana",
        amount_cents: 80000,
        due_date: "2026-10-20",
      },
    });
  });
});
