import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PosPage from "./PosPage";
import { useOrders } from "../store/orders";
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

const emptySummary = {
  date: "2026-10-13",
  cash_total_cents: 0,
  gcash_total_cents: 0,
  sale_count: 0,
  voided_count: 0,
};

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function sale(
  id: number,
  totalCents: number,
  payment: string,
  lines: { menu_item_id: number; qty: number }[],
) {
  return {
    id,
    total_cents: totalCents,
    payment,
    voided: 0,
    paid: 0,
    created_at: "2026-10-13 10:00:00",
    items: lines.map((line, index) => ({
      id: index + 1,
      menu_item_id: line.menu_item_id,
      qty: line.qty,
      unit_price_cents: 7000,
    })),
  };
}

/** Menu + empty Today panel; sales POST/PATCH fall through to onSale. */
function menuFetch(
  onSale?: (u: string, init?: RequestInit) => Promise<Response>,
) {
  return async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/categories") return ok(categories);
    if (u === "/api/menu_items?active=1") return ok(items);
    if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
    if (u.startsWith("/api/sales?")) return ok([]);
    if (onSale && (u === "/api/sales" || u.startsWith("/api/sales/"))) {
      return onSale(u, init);
    }
    throw new Error(`unexpected fetch ${u}`);
  };
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

function resetOrders() {
  useOrders.setState({
    orders: [
      { key: "order-1", label: "Order #1", lines: [], payment: "cash", status: "open", sale: null },
    ],
    activeKey: "order-1",
    nextNumber: 2,
  });
}

function selected(name: string): string | null {
  return screen.getByRole("tab", { name }).getAttribute("aria-selected");
}

beforeEach(() => {
  resetOrders();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("POS checkout flow", () => {
  it("disables Finalize on an empty cart", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");
    expect(
      (screen.getByRole("button", { name: "Finalize" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("posts {payment, items, paid} with no ref field and shows the server-computed total", async () => {
    let payload: unknown;
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          payload = JSON.parse(String(init?.body));
          const body = payload as { payment: string; items: { menu_item_id: number; qty: number }[] };
          return ok(sale(7, 22000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    fireEvent.click(screen.getByRole("button", { name: "GCash" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Sale #7")).toBeDefined();
    expect(screen.getByText("₱220")).toBeDefined();
    expect(screen.getByText("GCash")).toBeDefined();

    // Exact payload shape: method + lines + paid flag, never a ref field.
    expect(Object.keys(payload as Record<string, unknown>).sort()).toEqual([
      "items",
      "paid",
      "payment",
    ]);
    expect(payload).toEqual({
      payment: "gcash",
      items: [
        { menu_item_id: 1, qty: 1 },
        { menu_item_id: 2, qty: 1 },
      ],
      paid: 0,
    });
    expect(payload).not.toHaveProperty("ref");
  });

  it("shows an error with retry and recovers on the next attempt", async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn(
      menuFetch(async (u) => {
        if (u === "/api/sales") {
          attempts += 1;
          if (attempts === 1) return ok({ error: "boom" }, 500);
          return ok(sale(8, 7000, "cash", [{ menu_item_id: 1, qty: 1 }]), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

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
      if (u.startsWith("/api/sales?") && u.includes("since="))
        return ok([
          { id: 1, total_cents: 16000, payment: "cash", voided: 0, paid: 0, created_at: `${today} 06:30:00` },
          { id: 2, total_cents: 9000, payment: "gcash", voided: 1, paid: 1, created_at: `${today} 07:15:00` },
        ]);
      if (u.startsWith("/api/sales?")) return ok([]);
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
      { id: 1, total_cents: 16000, payment: "cash", voided: 0, paid: 0, created_at: `${today} 06:30:00` },
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
      if (u.startsWith("/api/sales?") && u.includes("since=")) return ok(rows);
      if (u.startsWith("/api/sales?")) return ok([]);
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
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

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
      (screen.getByRole("button", { name: "Finalize" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("POS order tabs", () => {
  it("adds, switches, and closes tabs with monotonic labels", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    expect(selected("Order #1 (0)")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Order #2 (0)")).toBe("true");
    expect(selected("Order #1 (0)")).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (0)" }));
    expect(selected("Order #1 (0)")).toBe("true");

    // Numbers never reuse: closing #3 after adding it yields #4 next.
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Order #3 (0)")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close Order #3" }));
    expect(screen.queryByRole("tab", { name: "Order #3 (0)" })).toBeNull();
    expect(selected("Order #2 (0)")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Order #4 (0)")).toBe("true");
  });

  it("item grid adds to the active order only", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(selected("Order #1 (1)")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(screen.getByText("Order is empty. Tap an item to add it.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    expect(selected("Order #2 (1)")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (1)" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
    expect(screen.queryByLabelText("Latte quantity")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Order #2 (1)" }));
    expect(screen.getByLabelText("Latte quantity").textContent).toBe("1");
    expect(screen.queryByLabelText("Cortado quantity")).toBeNull();
  });

  it("each order keeps its own payment method", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    fireEvent.click(screen.getByRole("button", { name: "GCash" }));
    expect(
      screen.getByRole("button", { name: "GCash" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (0)" }));
    expect(
      screen.getByRole("button", { name: "Cash" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "GCash" }).getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "Order #2 (0)" }));
    expect(
      screen.getByRole("button", { name: "GCash" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("closing the last tab creates a fresh empty order", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(selected("Order #1 (1)")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close Order #1" }));
    expect(screen.queryByRole("tab", { name: "Order #1 (1)" })).toBeNull();
    expect(selected("Order #2 (0)")).toBe("true");
    expect(screen.getByText("Order is empty. Tap an item to add it.")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Finalize" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("POS per-order checkout", () => {
  it("posts the active order only, locks the receipt, and clears via New sale", async () => {
    let payload: unknown;
    let posts = 0;
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          posts += 1;
          payload = JSON.parse(String(init?.body));
          const body = payload as { payment: string; items: { menu_item_id: number; qty: number }[] };
          return ok(sale(9, 15500, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    // Cortado on Order #1, Latte on Order #2; checkout posts #2 only.
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(payload).toEqual({
      payment: "cash",
      items: [{ menu_item_id: 2, qty: 1 }],
      paid: 0,
    });
    expect(screen.getByText("Sale #9")).toBeDefined();
    expect(screen.getByText("₱155")).toBeDefined();

    // Receipt lock: no second Finalize to double-post with.
    expect(screen.queryByRole("button", { name: "Finalize" })).toBeNull();
    expect(posts).toBe(1);

    // The other tab is untouched and still editable.
    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (1)" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
    expect(
      (screen.getByRole("button", { name: "Finalize" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // New sale clears the locked tab back to an open, empty order.
    fireEvent.click(screen.getByRole("tab", { name: "Order #2 (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "New sale" }));
    expect(screen.getByText("Order is empty. Tap an item to add it.")).toBeDefined();
    expect(selected("Order #2 (0)")).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Finalize" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(posts).toBe(1);
  });

  it("double-clicking Finalize posts only once", async () => {
    let posts = 0;
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = vi.fn(
      menuFetch(async (u) => {
        if (u === "/api/sales") {
          posts += 1;
          return gate;
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    const checkout = screen.getByRole("button", { name: "Finalize" });
    fireEvent.click(checkout);
    fireEvent.click(checkout);
    release(ok(sale(10, 7000, "cash", [{ menu_item_id: 1, qty: 1 }]), 201));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Sale #10")).toBeDefined();
    expect(posts).toBe(1);
  });
});

describe("POS paid flow with history", () => {
  const today = new Date().toISOString().slice(0, 10);

  function unpaidSale(
    id: number,
    totalCents: number,
    payment: string,
    lines: { menu_item_id: number; qty: number }[],
  ) {
    return {
      ...sale(id, totalCents, payment, lines),
      paid: 0,
      created_at: `${today} 10:00:00`,
    };
  }

  it("order panel header shows today's date", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    expect(screen.getByText(today, { exact: false })).toBeDefined();
  });

  it("empty order reads the order-empty text", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    expect(
      screen.getByText("Order is empty. Tap an item to add it."),
    ).toBeDefined();
  });

  it("finalize posts paid 0 and the finalized order shows UNPAID in red", async () => {
    let payload: unknown;
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          payload = JSON.parse(String(init?.body));
          return ok(unpaidSale(21, 7000, "cash", [{ menu_item_id: 1, qty: 1 }]), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });
    expect(payload).toMatchObject({ paid: 0 });
    const badge = screen.getByText("UNPAID");
    expect(badge.className).toMatch(/red/);
    // Order details carry the UTC date.
    expect(screen.getAllByText(new RegExp(today)).length).toBeGreaterThan(0);
  });

  it("unpaid finalized order stays editable and steppers re-PUT items", async () => {
    const puts: unknown[] = [];
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            payment: string;
            items: { menu_item_id: number; qty: number }[];
          };
          return ok(unpaidSale(22, 7000, body.payment, body.items), 201);
        }
        if (u === "/api/sales/22/items" && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            items: { menu_item_id: number; qty: number }[];
          };
          puts.push(body);
          const qty = body.items[0]?.qty ?? 1;
          return ok({
            ...unpaidSale(22, 7000 * qty, "cash", body.items),
            items: body.items.map((line, index) => ({
              id: index + 1,
              menu_item_id: line.menu_item_id,
              qty: line.qty,
              unit_price_cents: 7000,
            })),
          });
        }
        throw new Error(`unexpected fetch ${u} ${init?.method}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Increase Cortado quantity" }),
    );

    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]).toEqual({ items: [{ menu_item_id: 1, qty: 2 }] });
    await waitFor(() => {
      // Refreshed server total renders twice: the sale total and the line.
      expect(screen.getAllByText("₱140")).toHaveLength(2);
    });
  });

  it("mark paid PATCHes paid 1, closes the tab, and lists under Paid today", async () => {
    const patches: unknown[] = [];
    let paid = 0;
    const row = () => ({
      id: 23,
      total_cents: 7000,
      payment: "cash",
      voided: 0,
      paid,
      created_at: `${today} 10:00:00`,
    });
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
      if (u === "/api/sales" && init?.method === "POST") {
        return ok(
          {
            ...unpaidSale(23, 7000, "cash", [{ menu_item_id: 1, qty: 1 }]),
            items: [
              { id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000 },
            ],
          },
          201,
        );
      }
      if (u === "/api/sales/23" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        paid = body.paid;
        return ok(row());
      }
      // Today list vs history: only since-scoped rows are today's.
      if (u.startsWith("/api/sales?") && u.includes("since=")) return ok([row()]);
      if (u.startsWith("/api/sales?")) return ok([]);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }));

    await waitFor(() => {
      expect(patches).toEqual([{ paid: 1 }]);
    });
    // Tab closed: the finalized banner is gone and a fresh order is open.
    await waitFor(() => {
      expect(screen.queryByText("Sale complete")).toBeNull();
    });
    expect(
      screen.getByText("Order is empty. Tap an item to add it."),
    ).toBeDefined();
    // The sale now lives under Paid today.
    const paidList = await screen.findByRole("list", { name: "Paid today sales" });
    expect(within(paidList).getByText("Sale #23")).toBeDefined();
  });

  it("history section lists a past-date sale", async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
      if (u.startsWith("/api/sales?") && u.includes("since=")) return ok([]);
      if (u.startsWith("/api/sales?"))
        return ok([
          {
            id: 31,
            total_cents: 5000,
            payment: "gcash",
            voided: 0,
            paid: 1,
            created_at: "2026-10-12 08:00:00",
          },
        ]);
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    expect(
      screen.getByRole("heading", { name: "History" }),
    ).toBeDefined();
    const history = screen.getByRole("list", { name: "History sales" });
    expect(within(history).getByText("Sale #31")).toBeDefined();
  });

  it("mark unpaid PATCHes paid 0 and returns the row to Unpaid, red", async () => {
    const patches: unknown[] = [];
    let paid = 1;
    const row = () => ({
      id: 41,
      total_cents: 9000,
      payment: "gcash",
      voided: 0,
      paid,
      created_at: `${today} 07:15:00`,
    });
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
      if (u === "/api/sales/41" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        paid = body.paid;
        return ok(row());
      }
      if (u.startsWith("/api/sales?") && u.includes("since=")) return ok([row()]);
      if (u.startsWith("/api/sales?")) return ok([]);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    // Paid row starts under Paid today.
    const paidList = await screen.findByRole("list", { name: "Paid today sales" });
    expect(within(paidList).getByText("Sale #41")).toBeDefined();

    fireEvent.click(
      within(paidList).getByRole("button", { name: "Mark sale 41 unpaid" }),
    );

    await waitFor(() => {
      expect(patches).toEqual([{ paid: 0 }]);
    });
    // Row moves back under Unpaid and reads red.
    const unpaidList = await screen.findByRole("list", { name: "Unpaid sales" });
    await waitFor(() => {
      expect(within(unpaidList).getByText("Sale #41")).toBeDefined();
    });
    const li = within(unpaidList).getByText("Sale #41").closest("li");
    expect(li?.className).toMatch(/red/);
  });
});
