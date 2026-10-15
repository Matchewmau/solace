import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
  dailySeq = 1,
) {
  return {
    id,
    daily_seq: dailySeq,
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
  // MemoryRouter supplies context for the Today/History nav links; the
  // POS shell itself renders standalone (route wiring is covered by the
  // Today/History page tests).
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PosPage />
      </MemoryRouter>
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
  it("disables Done on an empty cart", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("open-order button reads Done with Saving… pending", async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = vi.fn(
      menuFetch(async (u) => {
        if (u === "/api/sales") return gate;
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    // Idle label reads Done (not Finalize).
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Pending label reads Saving….
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Saving…" })).toBeDefined();
    });
    release(ok(sale(99, 7000, "cash", [{ menu_item_id: 1, qty: 1 }]), 201));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Order #1 · Sale #7")).toBeDefined();
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Order #1 · Sale #8")).toBeDefined();
  });

describe("POS nav to Today + History pages", () => {
  it("far-left nav links to the Today and History pages", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    // The inline Today/History sections are gone — the nav owns the links.
    expect(
      screen.queryByRole("heading", { name: "Today" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "History" }),
    ).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(
      within(nav).getByRole("link", { name: "Today" }).getAttribute("href"),
    ).toBe("/today");
    expect(
      within(nav).getByRole("link", { name: "History" }).getAttribute("href"),
    ).toBe("/history");
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
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("POS order tabs", () => {
  it("adds and switches tabs; new order reaps empty temps without bumping numbers", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    expect(selected("Order #1 (0)")).toBe("true");

    // New order on an empty tab reaps and recreates it — no count bump.
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Order #1 (0)")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    // With lines on #1, New order stacks a second tab.
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(selected("Order #1 (1)")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Order #2 (0)")).toBe("true");
    expect(selected("Order #1 (1)")).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (1)" }));
    expect(selected("Order #1 (1)")).toBe("true");

    // The empty #2 is reaped by the next New order (temp number reused).
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Order #2 (0)")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Rail has zero close buttons — Delete-after-Done is the only removal.
    expect(screen.queryByRole("button", { name: /Close Order/ })).toBeNull();
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

    // Order #1 needs a line so the next New order keeps (not reaps) it.
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    fireEvent.click(screen.getByRole("button", { name: "GCash" }));
    expect(
      screen.getByRole("button", { name: "GCash" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (1)" }));
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

  it("Delete on a done tab closes it locally without touching the sale", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        seen.push(`${init?.method ?? "GET"} ${u}`);
        if (u === "/api/sales" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            payment: string;
            items: { menu_item_id: number; qty: number }[];
          };
          return ok(sale(60, 7000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u} ${init?.method}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(selected("Order #1 (1)")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("Sale complete");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Tab closed locally: receipt gone, fresh empty order open, no DELETE call.
    expect(screen.queryByText("Sale complete")).toBeNull();
    expect(screen.getByText("Order is empty. Tap an item to add it.")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(seen.some((entry) => entry.startsWith("DELETE"))).toBe(false);
  });

  it("rail has no close buttons and Edit allows adding new menu items", async () => {
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales" && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as {
            payment: string;
            items: { menu_item_id: number; qty: number }[];
          };
          return ok(sale(50, 7000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u} ${init?.method}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");
    expect(screen.queryByRole("button", { name: /Close Order/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByText("Sale complete");
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    expect(screen.getByLabelText("Latte quantity")).toBeDefined();
  });
});

describe("POS per-order checkout", () => {
  it("posts the active order only, locks the receipt with Edit|Delete, and Delete closes locally", async () => {
    let payload: unknown;
    let posts = 0;
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          posts += 1;
          payload = JSON.parse(String(init?.body));
          const body = payload as { payment: string; items: { menu_item_id: number; qty: number }[] };
          return ok(sale(9, 15500, body.payment, body.items, 2), 201);
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(payload).toEqual({
      payment: "cash",
      items: [{ menu_item_id: 2, qty: 1 }],
      paid: 0,
    });
    expect(screen.getByText("Order #2 · Sale #9")).toBeDefined();
    expect(screen.getByText("₱155")).toBeDefined();

    // Receipt lock: no second Done to double-post with — Edit|Delete instead.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New sale" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
    expect(posts).toBe(1);

    // The other tab is untouched and still editable.
    fireEvent.click(screen.getByRole("tab", { name: "Order #1 (1)" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Delete closes the done tab locally (sale stays in history).
    fireEvent.click(screen.getByRole("tab", { name: "Order #2 (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Sale complete")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Order #2 (1)" })).toBeNull();
    expect(selected("Order #1 (1)")).toBe("true");
    expect(posts).toBe(1);
  });

  it("double-clicking Done posts only once", async () => {
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
    const checkout = screen.getByRole("button", { name: "Done" });
    fireEvent.click(checkout);
    fireEvent.click(checkout);
    release(ok(sale(10, 7000, "cash", [{ menu_item_id: 1, qty: 1 }]), 201));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Order #1 · Sale #10")).toBeDefined();
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
    dailySeq = 1,
  ) {
    return {
      ...sale(id, totalCents, payment, lines, dailySeq),
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });
    expect(payload).toMatchObject({ paid: 0 });
    const badge = screen.getByText("UNPAID");
    expect(badge.className).toMatch(/red/);
    // Order details carry the UTC date.
    expect(screen.getAllByText(new RegExp(today)).length).toBeGreaterThan(0);
  });

  it("Edit reopens the order and re-Done PUTs the staged lines", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });

    // Locked receipt has no steppers — Edit reopens to stage changes.
    expect(
      screen.queryByRole("button", { name: "Increase Cortado quantity" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Increase Cortado quantity" }),
    );
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("2");
    // Staged locally: no PUT until re-Done.
    expect(puts).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]).toEqual({ items: [{ menu_item_id: 1, qty: 2 }] });
    await waitFor(() => {
      // Refreshed server total renders twice: the sale total and the line.
      expect(screen.getAllByText("₱140")).toHaveLength(2);
    });
  });

  it("mark paid PATCHes paid 1 and closes the tab (settlement lives in Details)", async () => {
    const patches: unknown[] = [];
    let paid = 0;
    const row = () => ({
      id: 23,
      daily_seq: 1,
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
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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
    // Settlement lives in Order Details only — the sale appears under
    // Paid today on the /today page, never inline here.
    expect(
      screen.queryByRole("button", { name: /Mark sale/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Void sale/ })).toBeNull();
  });

  it("Details Mark unpaid PATCHes paid 0 and keeps the tab open with UNPAID", async () => {
    // A paid holding tab (e.g. reopened from Today) settles back to unpaid
    // via the Order Details button — the tab stays, lines stay editable.
    useOrders.setState({
      orders: [
        {
          key: "order-9",
          label: "Order #9",
          lines: [{ menu_item_id: 1, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: {
            id: 41,
            daily_seq: 9,
            total_cents: 7000,
            payment: "cash",
            voided: 0,
            paid: 1,
            created_at: `${today} 07:15:00`,
            items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000 }],
          },
          dailySeq: 9,
          tempNo: 9,
        },
      ],
      activeKey: "order-9",
    });
    const patches: unknown[] = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
      if (u.startsWith("/api/sales?")) return ok([]);
      if (u === "/api/sales/41" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        return ok({
          id: 41,
          daily_seq: 9,
          total_cents: 7000,
          payment: "cash",
          voided: 0,
          paid: body.paid,
          created_at: `${today} 07:15:00`,
          items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000 }],
        });
      }
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    expect(screen.getByText("PAID")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Mark unpaid" }));

    await waitFor(() => {
      expect(patches).toEqual([{ paid: 0 }]);
    });
    // Receipt stays open on the same tab, now UNPAID, with Edit available.
    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Mark sale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Void sale/ })).toBeNull();
  });
});

describe("POS theme lock", () => {
  // Verbatim token hexes (paper #faf8f4, ink #141210, accent #8a5a2b,
  // muted #6f6a61) are asserted in client/src/App.test.tsx:14-21 against
  // client/src/brand.ts — not duplicated here. These tests lock how the
  // POS shell *applies* those tokens. UNPAID red is already locked by
  // "finalize posts paid 0 and the finalized order shows UNPAID in red".
  it("shell uses paper/ink, rail-active tab uses coffee fill", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    const shell = screen.getByRole("main");
    expect(shell.className).toContain("bg-paper");
    expect(shell.className).toContain("text-ink");

    // Rail-active tab carries the coffee fill; inactive tabs do not.
    expect(
      screen.getByRole("tab", { name: "Order #1 (0)" }).className,
    ).toContain("bg-accent");
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(
      screen.getByRole("tab", { name: "Order #2 (0)" }).className,
    ).toContain("bg-accent");
    expect(
      screen.getByRole("tab", { name: "Order #1 (1)" }).className,
    ).not.toContain("bg-accent");
  });

  it("category pills render above the menu item grid", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    const menu = screen.getByRole("region", { name: "Menu items" });
    const pills = within(menu).getByRole("group", {
      name: "Category filter",
    });
    const grid = within(menu).getByRole("list");
    expect(
      pills.compareDocumentPosition(grid) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("done receipt Delete reads destructive red", async () => {
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          const body = JSON.parse(String(init?.body)) as {
            payment: string;
            items: { menu_item_id: number; qty: number }[];
          };
          return ok(sale(31, 7000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });

    // Destructive-action lock: Delete is explicitly red-bordered red
    // text; Edit stays ink-outline.
    const del = screen.getByRole("button", { name: "Delete" }).className;
    expect(del).toContain("border-red-600");
    expect(del).toContain("text-red-600");
    expect(
      screen.getByRole("button", { name: "Edit" }).className,
    ).not.toContain("red");
  });
});

describe("POS order/sale label linking", () => {
  it("finalized tab receipt header reads Order #N · Sale #M", async () => {
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          const body = JSON.parse(String(init?.body)) as {
            payment: string;
            items: { menu_item_id: number; qty: number }[];
          };
          return ok(sale(4, 7000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(screen.getByText("Order #1 · Sale #4")).toBeDefined();
  });
});
