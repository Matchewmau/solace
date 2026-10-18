import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "../components/AuthProvider";
import { routes } from "../routes";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { SaleRow } from "../api/sales";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function row(id: number, totalCents: number): SaleRow {
  return {
    id,
    daily_seq: id,
    total_cents: totalCents,
    payment: "cash",
    voided: 0,
    paid: 1,
    created_at: `2026-10-12 0${id % 10}:00:00`,
  };
}

function renderHistory(rows: SaleRow[]) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.startsWith("/api/sales?")) return ok(rows);
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  setStoredAuth("solace123");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: ["/history"] });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function firstRow(): string {
  const first = document.querySelector("tbody tr");
  return first?.textContent ?? "";
}

function bodyRowCount(): number {
  return document.querySelectorAll("tbody tr").length;
}

function datedRow(id: number, date: string): SaleRow {
  return {
    id,
    daily_seq: id,
    total_cents: id * 100,
    payment: "cash",
    voided: 0,
    paid: 1,
    created_at: `${date} 12:00:00`,
  };
}

/** 25 sales on consecutive days: 2026-10-01 … 2026-10-25. */
function datedFixture(): SaleRow[] {
  return Array.from({ length: 25 }, (_, i) =>
    datedRow(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`),
  );
}

describe("HistoryPage table", () => {
  it("history table sorts by total and has no action buttons", async () => {
    renderHistory([row(31, 5000), row(32, 9000)]);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Total/ }));
    expect(firstRow()).toContain("Sale #32");
    expect(screen.queryByRole("button", { name: /Mark sale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Void sale/ })).toBeNull();
  });

  it("table is sortable by date and has no back link", async () => {
    renderHistory([row(31, 5000), row(32, 9000)]);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sale #31")).toBeDefined();
    // First click sorts descending (newest first): Sale #32 (02:00) leads.
    fireEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(firstRow()).toContain("Sale #32");
    // Second click flips to ascending: Sale #31 (01:00) leads.
    fireEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(firstRow()).toContain("Sale #31");
    // No back link: the global rail owns the way back to POS.
    expect(screen.queryByRole("link", { name: "Back to POS" })).toBeNull();
  });

  it("logged-out visits bounce to /login", async () => {
    clearStoredAuth();
    globalThis.fetch = vi.fn(async () => ok([])) as typeof fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/history"] });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "Login" });
  });
});

describe("HistoryPage filters and pagination", () => {
  it("shows 20 rows on page 1 and the last 5 on page 2", async () => {
    renderHistory(datedFixture());
    await screen.findByRole("table");
    expect(bodyRowCount()).toBe(20);
    expect(screen.getByText("Showing 1–20 of 25")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(bodyRowCount()).toBe(5);
    expect(screen.getByText("Showing 21–25 of 25")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(bodyRowCount()).toBe(20);
    expect(screen.getByText("Showing 1–20 of 25")).toBeDefined();
  });

  it("narrows rows inclusively on the From date", async () => {
    renderHistory(datedFixture());
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-10-21" },
    });
    expect(bodyRowCount()).toBe(5);
    expect(screen.getByText("Showing 1–5 of 5")).toBeDefined();
    expect(firstRow()).toContain("Sale #21");
  });

  it("resets to page 1 when the filter changes", async () => {
    renderHistory(datedFixture());
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(bodyRowCount()).toBe(5);

    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-10-02" },
    });
    // 24 rows remain, so page 2 would still exist — resetting to page 1 is what
    // makes the first 20 rows show.
    expect(bodyRowCount()).toBe(20);
    expect(screen.getByText("Showing 1–20 of 24")).toBeDefined();
  });

  it("Clear restores the unfiltered ledger", async () => {
    renderHistory(datedFixture());
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-10-21" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-10-22" },
    });
    expect(bodyRowCount()).toBe(2);
    expect(screen.getByText("Showing 1–2 of 2")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(bodyRowCount()).toBe(20);
    expect(screen.getByText("Showing 1–20 of 25")).toBeDefined();
    expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText("To date") as HTMLInputElement).value).toBe("");
  });
});
