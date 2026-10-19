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
  {
    id: 1,
    name: "Meralco",
    amount_cents: 250000,
    due_date: "2026-10-21",
    due_day: 21,
    frequency: "weekly",
    end_date: "2026-11-25",
    alert_days: 5,
    series_id: 1,
    source_bill_id: null,
    paid: 0,
  },
  {
    id: 2,
    name: "Rent",
    amount_cents: 600000,
    due_date: "2026-10-01",
    due_day: 1,
    frequency: "monthly",
    end_date: null,
    alert_days: 3,
    series_id: 2,
    source_bill_id: null,
    paid: 1,
  },
];

const patched: Array<{ url: string; body: unknown }> = [];
const created: Array<{ url: string; body: unknown; headers: unknown }> = [];
let patchFailure: { status: number; error: string } | null = null;

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
  patchFailure = null;
  setStoredAuth("solace123");
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/bills" && (!init || init.method === undefined)) {
      return ok(bills.map((bill) => ({ ...bill })));
    }
    const billMatch = u.match(/^\/api\/bills\/(\d+)$/);
    if (billMatch && init?.method === "PATCH") {
      if (patchFailure !== null) {
        return ok({ error: patchFailure.error }, patchFailure.status);
      }
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

  it("renders the schedule and alert lead time in the table", async () => {
    stubFetch();
    renderPage();

    const row = (await screen.findByText("Meralco")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("2026-10-21")).toBeDefined();
    expect(within(row).getByText("Weekly")).toBeDefined();
    expect(within(row).getByText("until 2026-11-25")).toBeDefined();
    expect(within(row).getByText("5 days")).toBeDefined();
  });

  it("adds a bill with due date, repeat, end date, and alert days", async () => {
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
    fireEvent.change(within(form).getByLabelText("Due date"), {
      target: { value: "2026-11-20" },
    });
    fireEvent.change(within(form).getByLabelText("Repeats"), {
      target: { value: "weekly" },
    });
    fireEvent.change(within(form).getByLabelText("Ends on (optional)"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.change(within(form).getByLabelText("Alert days"), {
      target: { value: "6" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "5 days" }));
    expect(
      (within(form).getByLabelText("Alert days") as HTMLInputElement).value,
    ).toBe("5");
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0].url).toBe("/api/bills");
    expect(created[0].body).toEqual({
      name: "Water",
      amount_cents: 15000,
      due_date: "2026-11-20",
      frequency: "weekly",
      end_date: "2026-12-31",
      alert_days: 5,
    });
  });

  it("rejects an end date before the due date without posting", async () => {
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
    fireEvent.change(within(form).getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(within(form).getByLabelText("Ends on (optional)"), {
      target: { value: "2026-11-30" },
    });
    fireEvent.submit(form);

    expect(
      await screen.findByText("End date must be on or after the due date."),
    ).toBeDefined();
    expect(created).toHaveLength(0);
  });

  it("shows an error when unpaying after the next cycle is paid", async () => {
    stubFetch();
    patchFailure = {
      status: 400,
      error: "cannot unpay after the next cycle is paid",
    };
    renderPage();
    await screen.findByText("Rent");

    fireEvent.click(screen.getByRole("button", { name: "Toggle paid for Rent" }));

    expect(
      await screen.findByText("cannot unpay after the next cycle is paid"),
    ).toBeDefined();
  });
});
