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
import FinanceSalariesPage from "./FinanceSalariesPage";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Salary } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const salaries: Salary[] = [
  {
    id: 1,
    name: "Ana",
    amount_cents: 250000,
    note: "October payout",
    paid_at: "2026-10-15T08:30:00.000Z",
  },
  {
    id: 2,
    name: "Ben",
    amount_cents: 150000,
    note: "",
    paid_at: "2026-10-01T09:00:00.000Z",
  },
];

const posted: Array<{ url: string; body: unknown }> = [];

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubFetch(payload: Salary[] = salaries) {
  posted.length = 0;
  setStoredAuth("solace123");
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/salaries" && (!init || init.method === undefined)) {
      return ok(payload.map((salary) => ({ ...salary })));
    }
    if (u === "/api/salaries" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posted.push({ url: u, body });
      return ok(
        { id: 99, note: "", ...body, paid_at: "2026-10-19T04:00:00.000Z" },
        201,
      );
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
        <FinanceSalariesPage />
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

describe("FinanceSalariesPage", () => {
  it("renders the salary ledger with date, name, amount, and note", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole("table", { name: "Salaries" })).toBeDefined();
    for (const header of ["Date", "Name", "Amount", "Note"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeDefined();
    }

    const rows = bodyRowText();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("2026-10-15");
    expect(rows[0]).toContain("Ana");
    expect(rows[0]).toContain("₱2500");
    expect(rows[0]).toContain("October payout");
    expect(rows[1]).toContain("2026-10-01");
    expect(rows[1]).toContain("₱1500");
    // The table shows the UTC date only, never the raw timestamp.
    expect(screen.queryByText("2026-10-15T08:30:00.000Z")).toBeNull();
  });

  it("adds a salary with name, amount, and note", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("Ana");

    fireEvent.click(screen.getByRole("button", { name: "+ Add salary" }));
    const dialog = screen.getByRole("dialog", { name: "Add salary" });
    const form = within(dialog).getByLabelText(
      "Add salary form",
    ) as HTMLFormElement;
    // Salaries are server-stamped; the form never asks for a date.
    expect(form.querySelector('input[name="date"]')).toBeNull();

    fireEvent.change(
      form.querySelector('input[name="name"]') as HTMLInputElement,
      { target: { value: "Cara" } },
    );
    fireEvent.change(
      form.querySelector('input[name="amount"]') as HTMLInputElement,
      { target: { value: "1250" } },
    );
    fireEvent.change(form.querySelector('input[name="note"]') as HTMLInputElement, {
      target: { value: "Payout" },
    });
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]).toEqual({
      url: "/api/salaries",
      body: { name: "Cara", amount_cents: 125000, note: "Payout" },
    });
  });

  it("shows the empty state when there are no salaries", async () => {
    stubFetch([]);
    renderPage();

    expect(await screen.findByRole("table", { name: "Salaries" })).toBeDefined();
    expect(screen.getByText("No salaries recorded.")).toBeDefined();
    expect(bodyRowText()).toHaveLength(1);
    expect(bodyRowText()[0]).toContain("No salaries recorded.");
  });
});
