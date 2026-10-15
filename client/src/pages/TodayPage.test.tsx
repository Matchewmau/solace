import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "../components/AuthProvider";
import { routes } from "../routes";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import { useOrders } from "../store/orders";
import type { Sale, SaleRow } from "../api/sales";

const today = new Date().toISOString().slice(0, 10);

const categories = [{ id: 1, name: "Espresso", sort: 1 }];
const items = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1 },
];

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function summary(overrides = {}) {
  return {
    date: today,
    cash_total_cents: 0,
    gcash_total_cents: 0,
    sale_count: 0,
    voided_count: 0,
    next_order_number: 1,
    ...overrides,
  };
}

function row(partial: Partial<SaleRow> & { id: number }): SaleRow {
  return {
    daily_seq: partial.id,
    total_cents: 7000,
    payment: "cash",
    voided: 0,
    paid: 0,
    created_at: `${today} 06:30:00`,
    ...partial,
  };
}

function fullSale(id: number): Sale {
  return {
    id,
    daily_seq: 1,
    total_cents: 7000,
    payment: "cash",
    voided: 0,
    paid: 0,
    created_at: `${today} 06:30:00`,
    items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000 }],
  };
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

function resetOrders() {
  useOrders.setState({
    orders: [
      { key: "order-1", label: "Order #1", lines: [], payment: "cash", status: "open", sale: null, dailySeq: null, tempNo: 1 },
    ],
    activeKey: "order-1",
  });
}

beforeEach(() => {
  resetOrders();
  setStoredAuth("solace123");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

describe("TodayPage", () => {
  it("summary header renders split totals with voided flag and Void/Unvoid buttons, zero Mark paid buttons", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("/api/sales/summary"))
        return ok(
          summary({
            cash_total_cents: 16000,
            gcash_total_cents: 9000,
            sale_count: 1,
            voided_count: 1,
            next_order_number: 3,
          }),
        );
      if (u.startsWith("/api/sales?"))
        return ok([
          row({ id: 1, total_cents: 16000, paid: 0, created_at: `${today} 06:30:00` }),
          row({ id: 2, total_cents: 9000, payment: "gcash", voided: 1, paid: 1, created_at: `${today} 07:15:00` }),
        ]);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    renderAt("/today");
    await screen.findByRole("table", { name: "Unpaid sales" });

    // Split method totals via the shared formatPeso helper. Each amount
    // appears twice: once in the summary header, once in its sale row.
    expect(screen.getAllByText("₱160")).toHaveLength(2);
    expect(screen.getAllByText("₱90")).toHaveLength(2);
    expect(screen.getByText("Sale #1")).toBeDefined();
    expect(screen.getByText("Sale #2")).toBeDefined();
    expect(screen.getByText("1 voided", { exact: false })).toBeDefined();
    expect(screen.getByRole("button", { name: "Void sale 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Unvoid sale 2" })).toBeDefined();
    // Settlement lives exclusively in Order Details — no Mark buttons here.
    expect(screen.queryByRole("button", { name: /Mark sale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark paid/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark unpaid/ })).toBeNull();
  });

  it("void button issues PATCH {voided} and refreshes the list + summary", async () => {
    let rows = [row({ id: 1, total_cents: 16000, paid: 0 })];
    const patchBodies: unknown[] = [];
    const liveSummary = () => {
      const live = rows.filter((r) => r.voided === 0);
      return summary({
        cash_total_cents: live.reduce((sum, r) => sum + r.total_cents, 0),
        sale_count: live.length,
        voided_count: rows.filter((r) => r.voided === 1).length,
        next_order_number: 2,
      });
    };
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/sales/1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        rows = rows.map((r) => (r.id === 1 ? { ...r, voided: body.voided } : r));
        return ok({ ...rows[0], items: [] });
      }
      if (u.startsWith("/api/sales/summary")) return ok(liveSummary());
      if (u.startsWith("/api/sales?")) return ok(rows);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderAt("/today");
    const unpaid = await screen.findByRole("table", { name: "Unpaid sales" });
    await within(unpaid).findByText("Sale #1");
    // ₱160 twice: summary header + the sale row.
    expect(screen.getAllByText("₱160")).toHaveLength(2);
    expect(
      within(unpaid).queryByRole("button", { name: "Unvoid sale 1" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Void sale 1" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unvoid sale 1" })).toBeDefined();
    });
    expect(patchBodies).toEqual([{ voided: 1 }]);
    // Header "Voided" column + the voided row's flag cell.
    expect(within(unpaid).getAllByText("Voided")).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getAllByText("₱160")).toHaveLength(1);
    });
  });

  it("unpaid row held by a done tab appends the order label", async () => {
    useOrders.setState({
      orders: [
        {
          key: "order-1",
          label: "Order #1",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: fullSale(4),
          dailySeq: 1,
          tempNo: 1,
        },
      ],
      activeKey: "order-1",
    });
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("/api/sales/summary")) return ok(summary());
      if (u.startsWith("/api/sales?")) return ok([row({ id: 4, paid: 0 })]);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderAt("/today");
    const unpaid = await screen.findByRole("table", { name: "Unpaid sales" });
    expect(within(unpaid).getByText("Sale #4 (Order #1)")).toBeDefined();
  });

  it("paid-today row held by a done tab appends the order label", async () => {
    useOrders.setState({
      orders: [
        {
          key: "order-3",
          label: "Order #3",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: { ...fullSale(4), paid: 1 },
          dailySeq: 3,
          tempNo: 3,
        },
      ],
      activeKey: "order-3",
    });
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("/api/sales/summary")) return ok(summary());
      if (u.startsWith("/api/sales?")) return ok([row({ id: 4, paid: 1 })]);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderAt("/today");
    const paidTable = await screen.findByRole("table", { name: "Paid today sales" });
    expect(within(paidTable).getByText("Sale #4 (Order #3)")).toBeDefined();
  });

  it("row with no holding tab shows the sale label only", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("/api/sales/summary")) return ok(summary());
      if (u.startsWith("/api/sales?")) return ok([row({ id: 99, paid: 0 })]);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderAt("/today");
    const unpaid = await screen.findByRole("table", { name: "Unpaid sales" });
    const cell = within(unpaid).getByText("Sale #99");
    expect(cell.closest("tr")?.textContent).not.toMatch(/Order #/);
  });

  it("Reopen on an orphaned unpaid sale creates a holding tab and lands on /pos", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      seen.push(`${init?.method ?? "GET"} ${u}`);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(summary({ next_order_number: 2 }));
      if (u === "/api/sales/24") return ok(fullSale(24));
      if (u.startsWith("/api/sales?")) return ok([row({ id: 24, paid: 0 })]);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderAt("/today");
    await screen.findByRole("table", { name: "Unpaid sales" });

    fireEvent.click(screen.getByRole("button", { name: "Reopen sale 24" }));

    // Full sale fetched, holding tab created + selected, POS shell renders.
    await waitFor(() => {
      expect(seen).toContain("GET /api/sales/24");
    });
    const state = useOrders.getState();
    const holder = state.orders.find((order) => order.sale?.id === 24);
    expect(holder).toBeDefined();
    expect(state.activeKey).toBe(holder!.key);
    expect(holder!.lines).toEqual([{ menu_item_id: 1, qty: 1 }]);
    await screen.findByText("Sale complete");
    expect(screen.getByText("Order #1 · Sale #24")).toBeDefined();
  });

  it("Reopen on a held sale selects its tab without refetching", async () => {
    useOrders.setState({
      orders: [
        {
          key: "order-1",
          label: "Order #1",
          lines: [],
          payment: "cash",
          status: "open",
          sale: null,
          dailySeq: null,
          tempNo: 1,
        },
        {
          key: "order-sale-24",
          label: "Order #1",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: fullSale(24),
          dailySeq: 1,
          tempNo: 2,
        },
      ],
      activeKey: "order-1",
    });
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      seen.push(`${init?.method ?? "GET"} ${u}`);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(summary({ next_order_number: 2 }));
      if (u.startsWith("/api/sales?")) return ok([row({ id: 24, paid: 0 })]);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderAt("/today");
    await screen.findByRole("table", { name: "Unpaid sales" });

    fireEvent.click(screen.getByRole("button", { name: "Reopen sale 24" }));

    await screen.findByText("Sale complete");
    expect(useOrders.getState().activeKey).toBe("order-sale-24");
    expect(seen.filter((entry) => entry === "GET /api/sales/24")).toHaveLength(0);
  });

  it("logged-out visits bounce to /login", async () => {
    clearStoredAuth();
    globalThis.fetch = vi.fn(async () => ok([])) as typeof fetch;
    renderAt("/today");
    await screen.findByRole("heading", { name: "Login" });
  });
});
