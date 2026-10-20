import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "../components/AuthProvider";
import { routes } from "../routes";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { StockItem, StockMovement } from "../api/stock";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const items: StockItem[] = [
  { id: 1, name: "Milk", unit: "ml", qty: 45, low_threshold: 10, price_cents: 250 },
];

const movements: StockMovement[] = [
  {
    id: 9,
    stock_item_id: 1,
    delta: -5,
    reason: "waste",
    note: "Spilled",
    item_name: "Milk",
    item_unit: "ml",
    created_at: "2026-10-13 10:00:00",
  },
  {
    id: 10,
    stock_item_id: 1,
    delta: 20,
    reason: "delivery",
    note: "Morning delivery",
    item_name: "Milk",
    item_unit: "ml",
    created_at: "2026-10-14 09:00:00",
  },
  {
    id: 11,
    stock_item_id: 1,
    delta: -2,
    reason: "used",
    note: "2 lattes",
    item_name: "Milk",
    item_unit: "ml",
    created_at: "2026-10-15 09:00:00",
  },
  {
    id: 12,
    stock_item_id: 1,
    delta: 3,
    reason: "adjustment",
    note: "",
    item_name: "Milk",
    item_unit: "ml",
    created_at: "2026-10-16 09:00:00",
  },
];

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function stubFetch() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/stock_items" && (!init || init.method === undefined)) {
      return ok(items);
    }
    if (u.startsWith("/api/stock_movements?stock_item_id=")) {
      const id = Number(u.split("=").at(-1));
      if (id === 999) {
        return ok({ error: "stock item not found" }, 404);
      }
      return ok(movements.filter((m) => m.stock_item_id === id));
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("InventoryHistoryPage (own route)", () => {
  it("GET /inventory/history?item=1 humanizes reasons and shows item context", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/inventory/history?item=1");

    const table = await screen.findByRole("table", { name: "Movement history" });
    expect(table.textContent).toContain("Waste");
    expect(table.textContent).toContain("Delivery");
    expect(table.textContent).toContain("Used");
    expect(table.textContent).toContain("Count correction");
    expect(table.textContent).toContain("Milk · ml");
    expect(table.textContent).toContain("Spilled");
    expect(table.textContent).toContain("2 lattes");
    expect(table.textContent).toContain("-5");
    expect(table.textContent).toContain("20");
    expect(table.textContent).toContain("2026-10-13 10:00:00");
    for (const header of ["Reason", "Item", "Change", "Note", "Date"]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeDefined();
    }

    // Every body cell carries its column label for the phone row-card layout.
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      expect(
        Array.from(row.querySelectorAll("td")).map((cell) =>
          cell.getAttribute("data-label"),
        ),
      ).toEqual(["Reason", "Item", "Change", "Note", "Date"]);
    }

    // Only Date is sortable, so only its header is a button.
    expect(screen.getByRole("button", { name: "Date" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reason" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("unknown item id shows an error, not a table", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/inventory/history?item=999");

    expect(await screen.findByText("Could not load history.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("missing ?item= shows an error, not a table", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/inventory/history");

    expect(await screen.findByText("Unknown item.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("Inventory row History button navigates to that route", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/inventory");
    await screen.findByText("Milk");

    fireEvent.click(
      screen.getByRole("link", { name: "Show history for Milk" }),
    );

    // Navigation lands on the dedicated history route with a real table.
    const table = await screen.findByRole("table");
    expect(table.textContent).toContain("Waste");
    expect(
      screen.getByRole("link", { name: "Back to inventory" }),
    ).toBeDefined();
  });

  it("renders inside the authed layout (global rail present)", async () => {
    setStoredAuth("solace123");
    stubFetch();
    renderAt("/inventory/history?item=1");

    await screen.findByRole("table");
    expect(
      screen.getByRole("navigation", { name: "Pages" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Log out" }),
    ).toBeDefined();
  });
});
