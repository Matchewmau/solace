import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PosPage from "./PosPage";
import { useCart } from "../store/cart";
import type { Category, MenuItem } from "../api/menu";

const categories: Category[] = [
  { id: 1, name: "Espresso", sort: 1 },
  { id: 2, name: "Non-Coffee", sort: 2 },
];

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1 },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1 },
  { id: 3, category_id: 2, name: "Calamansi Cooler", price_cents: 5000, cost_cents: 1200, active: 1 },
];

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function renderPos() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PosPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCart.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("POS checkout flow", () => {
  it("disables Checkout on an empty cart", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");
    expect(
      (screen.getByRole("button", { name: "Checkout" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("posts {payment, items} with no ref field and shows the server-computed total", async () => {
    let payload: unknown;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u === "/api/sales") {
        payload = JSON.parse(String(init?.body));
        const body = payload as { payment: string; items: { menu_item_id: number; qty: number }[] };
        return ok(
          {
            id: 7,
            total_cents: 22000,
            payment: body.payment,
            voided: 0,
            created_at: "2026-10-13 10:00:00",
            items: body.items.map((line, index) => ({
              id: index + 1,
              menu_item_id: line.menu_item_id,
              qty: line.qty,
              unit_price_cents: 7000,
            })),
          },
          201,
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    fireEvent.click(screen.getByRole("button", { name: "GCash" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Sale #7")).toBeDefined();
    expect(screen.getByText("₱220")).toBeDefined();
    expect(screen.getByText("GCash")).toBeDefined();

    // Exact payload shape: method + lines only, never a ref field.
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      "items",
      "payment",
    ]);
    expect(payload).toEqual({
      payment: "gcash",
      items: [
        { menu_item_id: 1, qty: 1 },
        { menu_item_id: 2, qty: 1 },
      ],
    });
    expect(payload).not.toHaveProperty("ref");
  });

  it("shows an error with retry and recovers on the next attempt", async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u === "/api/sales") {
        attempts += 1;
        if (attempts === 1) return ok({ error: "boom" }, 500);
        return ok(
          {
            id: 8,
            total_cents: 7000,
            payment: "cash",
            voided: 0,
            created_at: "2026-10-13 10:00:00",
            items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000 }],
          },
          201,
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Sale #8")).toBeDefined();
  });

describe("Today panel + daily summary", () => {
  const today = new Date().toISOString().slice(0, 10);

  it("summary header renders split totals with voided flag and Void/Unvoid buttons", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary"))
        return ok({
          date: today,
          cash_total_cents: 16000,
          gcash_total_cents: 9000,
          sale_count: 1,
          voided_count: 1,
        });
      if (u.startsWith("/api/sales?"))
        return ok([
          { id: 1, total_cents: 16000, payment: "cash", voided: 0, created_at: `${today} 06:30:00` },
          { id: 2, total_cents: 9000, payment: "gcash", voided: 1, created_at: `${today} 07:15:00` },
        ]);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Today");

    // Split method totals via the shared formatPeso helper. Each amount
    // appears twice: once in the summary header, once in its sale row.
    expect(screen.getAllByText("₱160")).toHaveLength(2);
    expect(screen.getAllByText("₱90")).toHaveLength(2);

    expect(screen.getByText("Sale #1")).toBeDefined();
    expect(screen.getByText("Sale #2")).toBeDefined();
    expect(screen.getByText("Voided")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Void sale 1" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Unvoid sale 2" }),
    ).toBeDefined();
  });

  it("void button issues PATCH {voided} and refreshes the list + summary", async () => {
    let rows = [
      { id: 1, total_cents: 16000, payment: "cash", voided: 0, created_at: `${today} 06:30:00` },
    ];
    const patchBodies: unknown[] = [];
    const summary = () => {
      const live = rows.filter((row) => row.voided === 0);
      return {
        date: today,
        cash_total_cents: live
          .filter((row) => row.payment === "cash")
          .reduce((sum, row) => sum + row.total_cents, 0),
        gcash_total_cents: live
          .filter((row) => row.payment === "gcash")
          .reduce((sum, row) => sum + row.total_cents, 0),
        sale_count: live.length,
        voided_count: rows.filter((row) => row.voided === 1).length,
      };
    };
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u === "/api/sales/1" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        rows = rows.map((row) =>
          row.id === 1 ? { ...row, voided: body.voided } : row,
        );
        return ok({ ...rows[0], items: [] });
      }
      if (u.startsWith("/api/sales/summary")) return ok(summary());
      if (u.startsWith("/api/sales?")) return ok(rows);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Sale #1");
    // ₱160 twice: summary header + the sale row.
    expect(screen.getAllByText("₱160")).toHaveLength(2);
    expect(screen.queryByText("Voided")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Void sale 1" }));

    // PATCH payload is exactly {voided}, and the refreshed list + summary
    // show the void (flag, Unvoid button, header cash total back to zero
    // while the row keeps its rung-up total).
    await waitFor(() => {
      expect(screen.getByText("Voided")).toBeDefined();
    });
    expect(patchBodies).toEqual([{ voided: 1 }]);
    expect(
      screen.getByRole("button", { name: "Unvoid sale 1" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(screen.getAllByText("₱160")).toHaveLength(1);
    });
  });
});

  it("steppers adjust quantities and remove lines", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Cortado quantity" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Decrease Cortado quantity" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Remove Cortado from cart" }));
    expect(screen.queryByLabelText("Cortado quantity")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Checkout" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
