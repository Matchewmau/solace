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

describe("HistoryPage table", () => {
  it("history table sorts by total and has no action buttons", async () => {
    renderHistory([row(31, 5000), row(32, 9000)]);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Total/ }));
    expect(firstRow()).toContain("Sale #32");
    expect(screen.queryByRole("button", { name: /Mark sale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Void sale/ })).toBeNull();
  });

  it("table is sortable by date and links back to POS", async () => {
    renderHistory([row(31, 5000), row(32, 9000)]);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sale #31")).toBeDefined();
    // First click sorts descending (newest first): Sale #32 (02:00) leads.
    fireEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(firstRow()).toContain("Sale #32");
    // Second click flips to ascending: Sale #31 (01:00) leads.
    fireEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(firstRow()).toContain("Sale #31");
    expect(screen.getByRole("link", { name: "Back to POS" })).toBeDefined();
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
