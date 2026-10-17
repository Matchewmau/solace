import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PosPage from "./PosPage";
import { AuthedLayout } from "../components/AppHeader";
import { AuthProvider } from "../components/AuthProvider";
import { useOrders } from "../store/orders";
import type { Category, MenuItem } from "../api/menu";

const categories: Category[] = [
  { id: 1, name: "Espresso", sort: 1 },
  { id: 2, name: "Non-Coffee", sort: 2 },
];

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1, variants: [] },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1, variants: [] },
  { id: 3, category_id: 2, name: "Calamansi Cooler", price_cents: 5000, cost_cents: 1200, active: 1, variants: [] },
  { id: 4, category_id: 2, name: "Siomai", price_cents: 5000, cost_cents: 1500, active: 1, variants: ["Fried", "Steamed"] },
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
  lines: { menu_item_id: number; qty: number; variant?: string | null }[],
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
      variant: line.variant ?? null,
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
  // MemoryRouter keeps the standalone render route-safe; page tabs live
  // in the global rail (route wiring is covered by the dedup test below
  // and the AppHeader shell tests).
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
    // Cue is raised by the store's stale-day guard, never by the test seed.
    rolloverCue: false,
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
        { menu_item_id: 1, qty: 1, variant: null },
        { menu_item_id: 2, qty: 1, variant: null },
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

describe("POS nav dedup (global rail owns Pages)", () => {
  it("shows exactly one page nav with no local Today link", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    // Real /pos route shape: global SideNav shell + PosPage content.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/pos"]}>
          <AuthProvider>
            <Routes>
              <Route element={<AuthedLayout />}>
                <Route path="/pos" element={<PosPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Cortado");

    // One Pages nav total (the global rail); the local far-left nav is gone,
    // so the only Today link is the rail's.
    expect(
      screen
        .getAllByRole("navigation")
        .filter((n) => n.getAttribute("aria-label") === "Pages"),
    ).toHaveLength(1);
    expect(
      within(screen.getByRole("navigation", { name: "Pages" })).getByRole(
        "link",
        { name: "Today" },
      ),
    ).toBeDefined();
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

    expect(selected("Open · 0 items · ₱0")).toBe("true");

    // New order on an empty tab reaps and recreates it — no count bump.
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Open · 0 items · ₱0")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(1);

    // With lines on #1, New order stacks a second tab.
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(selected("Open · 1 items · ₱70")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Open · 0 items · ₱0")).toBe("true");
    expect(selected("Open · 1 items · ₱70")).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "Open · 1 items · ₱70" }));
    expect(selected("Open · 1 items · ₱70")).toBe("true");

    // The empty #2 is reaped by the next New order (temp number reused).
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(selected("Open · 0 items · ₱0")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Rail has zero close buttons — Delete-after-Done is the only removal.
    expect(screen.queryByRole("button", { name: /Close Order/ })).toBeNull();
  });

  it("New order on an empty active tab replaces it via discardEmpty rather than stacking", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    // Explicit wiring lock: newTab() calls discardEmpty on the empty
    // active tab before addOrder (whose internal reap stays as backstop).
    const spy = vi.spyOn(useOrders.getState(), "discardEmpty");
    try {
      fireEvent.click(screen.getByRole("button", { name: "New order" }));
      expect(spy).toHaveBeenCalledWith("order-1");
    } finally {
      spy.mockRestore();
    }
    // Replaced, not stacked: still exactly one tab.
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(selected("Open · 0 items · ₱0")).toBe("true");
  });

  it("item grid adds to the active order only", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(selected("Open · 1 items · ₱70")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(screen.getByText("Order is empty. Tap an item to add it.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Latte/ }));
    expect(selected("Open · 1 items · ₱80")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Open · 1 items · ₱70" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
    expect(screen.queryByLabelText("Latte quantity")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Open · 1 items · ₱80" }));
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

    fireEvent.click(screen.getByRole("tab", { name: "Open · 1 items · ₱70" }));
    expect(
      screen.getByRole("button", { name: "Cash" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "GCash" }).getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "Open · 0 items · ₱0" }));
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
    expect(selected("Open · 1 items · ₱70")).toBe("true");
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
      items: [{ menu_item_id: 2, qty: 1, variant: null }],
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
    fireEvent.click(screen.getByRole("tab", { name: "Open · 1 items · ₱70" }));
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    // Delete closes the done tab locally (sale stays in history).
    fireEvent.click(screen.getByRole("tab", { name: /Order #2 \(1\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Sale complete")).toBeNull();
    expect(screen.queryByRole("tab", { name: /Order #2 \(1\)/ })).toBeNull();
    expect(selected("Open · 1 items · ₱70")).toBe("true");
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
            items: { menu_item_id: number; qty: number; variant?: string | null }[];
          };
          return ok(unpaidSale(22, 7000, body.payment, body.items), 201);
        }
        if (u === "/api/sales/22/items" && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            items: { menu_item_id: number; qty: number; variant?: string | null }[];
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
              variant: line.variant ?? null,
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
    expect(puts[0]).toEqual({
      items: [{ menu_item_id: 1, qty: 2, variant: null }],
    });
    await waitFor(() => {
      // Refreshed server total renders twice: the sale total and the line.
      expect(screen.getAllByText("₱140")).toHaveLength(2);
    });
  });

  it("GCash Pay PATCHes paid 1 with no received amount and closes the tab after the delay", async () => {
    const patches: unknown[] = [];
    let paid = 0;
    const row = () => ({
      id: 23,
      daily_seq: 1,
      total_cents: 7000,
      payment: "gcash",
      voided: 0,
      paid,
      created_at: `${today} 10:00:00`,
      items: [
        { id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null },
      ],
    });
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
      if (u === "/api/sales" && init?.method === "POST") {
        return ok(
          {
            ...unpaidSale(23, 7000, "gcash", [{ menu_item_id: 1, qty: 1 }]),
            items: [
              { id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null },
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
    fireEvent.click(screen.getByRole("button", { name: "GCash" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.getByText("UNPAID")).toBeDefined();
    });

    // GCash skips the change calculator — Pay settles directly, no sheet.
    fireEvent.click(screen.getByRole("button", { name: "Pay ₱70.00" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(patches).toEqual([{ paid: 1 }]);
    });
    // Tab closed: the finalized banner is gone and a fresh order is open.
    // The close is now delayed by the celebrating (pop-glow) timeout.
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
          lines: [{ menu_item_id: 1, variant: null, qty: 1 }],
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
            items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null }],
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
          items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null }],
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

  it("paid receipt disables Edit; unpaid receipt keeps Edit enabled", async () => {
    function doneOrder(paid: 0 | 1) {
      return {
        key: "order-9",
        label: "Order #9",
        lines: [{ menu_item_id: 1, variant: null, qty: 1 }],
        payment: "cash" as const,
        status: "done" as const,
        sale: {
          id: 41,
          daily_seq: 9,
          total_cents: 7000,
          payment: "cash" as const,
          voided: 0,
          paid,
          created_at: `${today} 07:15:00`,
          items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null }],
        },
        dailySeq: 9,
        tempNo: 9,
      };
    }

    // Paid: reopenForEdit would no-op, so Edit must read disabled.
    useOrders.setState({ orders: [doneOrder(1)], activeKey: "order-9" });
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;
    const first = renderPos();
    await screen.findByText("Sale complete");
    expect(screen.getByText("PAID")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    first.unmount();
    cleanup();

    // Unpaid: Edit stays enabled and reopens the tab.
    useOrders.setState({ orders: [doneOrder(0)], activeKey: "order-9" });
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;
    renderPos();
    await screen.findByText("Sale complete");
    expect(screen.getByText("UNPAID")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe("POS cash change calculator flow", () => {
  const today = new Date().toISOString().slice(0, 10);

  /** A finalized holding tab seeded directly, bypassing the POST. */
  function doneOrder(sale: {
    id: number;
    total_cents: number;
    payment: "cash" | "gcash";
    paid: number;
    received_cents?: number | null;
    change_cents?: number | null;
  }) {
    return {
      key: "order-9",
      label: "Order #9",
      lines: [{ menu_item_id: 1, variant: null, qty: 1 }],
      payment: sale.payment,
      status: "done" as const,
      sale: {
        id: sale.id,
        daily_seq: 9,
        total_cents: sale.total_cents,
        payment: sale.payment,
        voided: 0,
        paid: sale.paid,
        received_cents: sale.received_cents ?? null,
        change_cents: sale.change_cents ?? null,
        created_at: `${today} 07:15:00`,
        items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null }],
      },
      dailySeq: 9,
      tempNo: 9,
    };
  }

  function seed(order: ReturnType<typeof doneOrder>) {
    useOrders.setState({ orders: [order], activeKey: order.key });
  }

  /** Menu + empty sales, plus a PATCH /api/sales/23 handler returning a paid row. */
  function payFetch(
    onPatch: (url: string, body: { paid: number; received_cents?: number }) => Response,
    onPatchCall?: () => void,
  ) {
    return vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items?active=1") return ok(items);
      if (u.startsWith("/api/sales/summary")) return ok(emptySummary);
      if (u === "/api/sales/23" && init?.method === "PATCH") {
        onPatchCall?.();
        return onPatch(u, JSON.parse(String(init.body)));
      }
      if (u.startsWith("/api/sales?")) return ok([]);
      throw new Error(`unexpected fetch ${u} ${init?.method}`);
    }) as typeof fetch;
  }

  it("offers Pay on an unpaid done tab and opens the cash sheet", async () => {
    seed(doneOrder({ id: 23, total_cents: 14000, payment: "cash", paid: 0 }));
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Sale complete");

    fireEvent.click(screen.getByRole("button", { name: "Pay ₱140.00" }));

    const dialog = screen.getByRole("dialog", { name: "Pay ₱140.00" });
    expect(within(dialog).getByText("short ₱140.00")).toBeDefined();
  });

  it("confirming cash posts the received amount, glows the tab, then closes it", async () => {
    const patches: { url: string; body: unknown }[] = [];
    const paidRow = {
      id: 23,
      daily_seq: 9,
      total_cents: 14000,
      payment: "cash",
      voided: 0,
      paid: 1,
      received_cents: 20000,
      change_cents: 6000,
      created_at: `${today} 07:15:00`,
      items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null }],
    };
    globalThis.fetch = payFetch((url, body) => {
      patches.push({ url, body });
      return ok(paidRow);
    });

    seed(doneOrder({ id: 23, total_cents: 14000, payment: "cash", paid: 0 }));
    renderPos();
    await screen.findByText("Sale complete");

    fireEvent.click(screen.getByRole("button", { name: "Pay ₱140.00" }));
    fireEvent.click(screen.getByRole("button", { name: "₱200" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm — paid ₱140.00" }),
    );

    await waitFor(() => {
      expect(patches).toEqual([
        { url: "/api/sales/23", body: { paid: 1, received_cents: 20000 } },
      ]);
    });

    // The settled tab flashes the green pop-glow before it is closed.
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /Order #9/ }).className,
      ).toContain("pop-glow");
    });

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Order #9/ })).toBeNull();
    });
    expect(
      screen.getByText("Order is empty. Tap an item to add it."),
    ).toBeDefined();
  });

  it("double-clicking Confirm submits the settlement only once", async () => {
    let release!: (res: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let patchCalls = 0;
    const paidRow = {
      id: 23,
      daily_seq: 9,
      total_cents: 14000,
      payment: "cash",
      voided: 0,
      paid: 1,
      received_cents: 20000,
      change_cents: 6000,
      created_at: `${today} 07:15:00`,
      items: [{ id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null }],
    };
    globalThis.fetch = payFetch(
      () => gate as unknown as Response,
      () => {
        patchCalls += 1;
      },
    );

    seed(doneOrder({ id: 23, total_cents: 14000, payment: "cash", paid: 0 }));
    renderPos();
    await screen.findByText("Sale complete");

    fireEvent.click(screen.getByRole("button", { name: "Pay ₱140.00" }));
    fireEvent.click(screen.getByRole("button", { name: "₱200" }));
    const confirm = screen.getByRole("button", {
      name: "Confirm — paid ₱140.00",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(patchCalls).toBe(1);

    release(ok(paidRow));
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Order #9/ })).toBeNull();
    });
  });

  it("shows Received and Change on a tendered cash receipt", async () => {
    seed(
      doneOrder({
        id: 23,
        total_cents: 14000,
        payment: "cash",
        paid: 1,
        received_cents: 20000,
        change_cents: 6000,
      }),
    );
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Sale complete");

    expect(screen.getByText("Received ₱200")).toBeDefined();
    expect(screen.getByText("Change ₱60")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
  });
});

describe("POS theme lock", () => {
  // Verbatim token hexes (paper #faf8f4, ink #141210, accent #8a5a2b,
  // muted #6f6a61) are asserted in client/src/App.test.tsx:14-21 against
  // client/src/brand.ts — not duplicated here. These tests lock how the
  // POS shell *applies* those tokens. UNPAID red is already locked by
  // "finalize posts paid 0 and the finalized order shows UNPAID in red".
  it("shell uses paper/ink, rail selection is an ink ring", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    const shell = screen.getByRole("main");
    expect(shell.className).toContain("bg-paper");
    expect(shell.className).toContain("text-ink");

    // Selection is the ink ring on every status surface (Task 11 contract);
    // open-with-items tabs also carry the accent left edge.
    expect(
      screen.getByRole("tab", { name: "Open · 0 items · ₱0" }).className,
    ).toContain("ring-2");
    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    fireEvent.click(screen.getByRole("button", { name: "New order" }));
    expect(
      screen.getByRole("tab", { name: "Open · 0 items · ₱0" }).className,
    ).toContain("ring-2");
    const openOne = screen.getByRole("tab", { name: "Open · 1 items · ₱70" });
    expect(openOne.className).not.toContain("ring-2");
    expect(openOne.className).toContain("border-l-accent");
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

describe("POS variant prompt", () => {
  // Grid-scoped so cart stepper buttons (also named after the item) can
  // never collide with the menu tile query.
  function menuTile(name: string | RegExp) {
    return within(screen.getByRole("region", { name: "Menu items" })).getByRole(
      "button",
      { name },
    );
  }

  it("prompts on tap for an item with variants and adds only the chosen line", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Siomai");

    fireEvent.click(menuTile(/Siomai/));

    // No line yet — the choice prompt is up instead.
    expect(
      screen.getByRole("dialog", { name: "Choose Siomai variant" }),
    ).toBeDefined();
    expect(screen.queryByLabelText("Siomai quantity")).toBeNull();
    expect(screen.queryByLabelText("Siomai (Fried) quantity")).toBeNull();
    expect(
      screen.getByText("Order is empty. Tap an item to add it."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Fried" }));
    expect(
      screen.queryByRole("dialog", { name: "Choose Siomai variant" }),
    ).toBeNull();
    expect(screen.getByLabelText("Siomai (Fried) quantity").textContent).toBe(
      "1",
    );
  });

  it("Cancel dismisses the prompt without adding a line", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Siomai");

    fireEvent.click(menuTile(/Siomai/));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("dialog", { name: "Choose Siomai variant" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Siomai (Fried) quantity")).toBeNull();
    expect(screen.queryByLabelText("Siomai (Steamed) quantity")).toBeNull();
    expect(
      screen.getByText("Order is empty. Tap an item to add it."),
    ).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Done" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps different variant choices as separate lines and checks them out with variant", async () => {
    let payload: unknown;
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          payload = JSON.parse(String(init?.body));
          const body = payload as {
            payment: string;
            items: { menu_item_id: number; qty: number; variant?: string | null }[];
          };
          return ok(sale(70, 10000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Siomai");

    fireEvent.click(menuTile(/Siomai/));
    fireEvent.click(screen.getByRole("button", { name: "Fried" }));
    fireEvent.click(menuTile(/Siomai/));
    fireEvent.click(screen.getByRole("button", { name: "Steamed" }));

    expect(screen.getByLabelText("Siomai (Fried) quantity").textContent).toBe(
      "1",
    );
    expect(screen.getByLabelText("Siomai (Steamed) quantity").textContent).toBe(
      "1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });
    expect(payload).toEqual({
      payment: "cash",
      items: [
        { menu_item_id: 4, qty: 1, variant: "Fried" },
        { menu_item_id: 4, qty: 1, variant: "Steamed" },
      ],
      paid: 0,
    });
    // Receipt slip shows each line as Name (Choice).
    expect(screen.getByText("Siomai (Fried) × 1")).toBeDefined();
    expect(screen.getByText("Siomai (Steamed) × 1")).toBeDefined();
  });

  it("items without variants add directly with no prompt", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(screen.getByRole("button", { name: /Cortado/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Cortado quantity").textContent).toBe("1");
  });
});

describe("POS order rail status, labels, and day cue", () => {
  // Grid-scoped so cart stepper buttons (also named after the item) can
  // never collide with the menu tile query.
  function menuTile(name: string | RegExp) {
    return within(screen.getByRole("region", { name: "Menu items" })).getByRole(
      "button",
      { name },
    );
  }

  it("labels an open order with its item count and peso estimate", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    // Fresh empty tab: quiet dashed surface, Open label, zero estimate.
    const fresh = screen.getByRole("tab");
    expect(fresh.textContent).toBe("Open · 0 items · ₱0");
    expect(fresh.className).toContain("border-dashed");
    expect(fresh.className).toContain("text-muted");
    expect(fresh.className).toContain("press");

    fireEvent.click(menuTile(/Cortado/));
    fireEvent.click(menuTile(/Cortado/));

    const open = screen.getByRole("tab");
    expect(open.textContent).toBe("Open · 2 items · ₱140");
    expect(open.className).toContain("border-l-accent");
    expect(open.className).toContain("bg-paper");
    // Selection is an ink ring, not a status fill.
    expect(open.className).toContain("ring-2");
    expect(open.className).toContain("ring-ink");
  });

  it("shows an unpaid done tab loudly in red with the server total", async () => {
    globalThis.fetch = vi.fn(
      menuFetch(async (u, init) => {
        if (u === "/api/sales") {
          const body = JSON.parse(String(init?.body)) as {
            payment: string;
            items: { menu_item_id: number; qty: number }[];
          };
          return ok(sale(9, 14000, body.payment, body.items), 201);
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    ) as typeof fetch;

    renderPos();
    await screen.findByText("Cortado");

    fireEvent.click(menuTile(/Cortado/));
    fireEvent.click(menuTile(/Cortado/));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.getByText("Sale complete")).toBeDefined();
    });

    const tab = screen.getByRole("tab");
    expect(tab.textContent).toBe("Order #1 (2) Unpaid · ₱140");
    expect(tab.className).toContain("bg-danger");
    expect(tab.className).toContain("text-paper");
    expect(tab.className).toContain("ring-2");
  });

  it("settles a paid done tab quietly into the green tint with a Paid line", async () => {
    // Paid tabs are seeded directly; the paid *flow* is Task 12's.
    useOrders.setState({
      orders: [
        {
          key: "order-9",
          label: "Order #9",
          lines: [{ menu_item_id: 1, variant: null, qty: 1 }],
          payment: "cash",
          status: "done",
          sale: {
            id: 41,
            daily_seq: 9,
            total_cents: 7000,
            payment: "cash",
            voided: 0,
            paid: 1,
            created_at: "2026-10-13 07:15:00",
            items: [
              { id: 1, menu_item_id: 1, qty: 1, unit_price_cents: 7000, variant: null },
            ],
          },
          dailySeq: 9,
          tempNo: 9,
        },
      ],
      activeKey: "order-9",
    });
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;

    renderPos();
    await screen.findByText("Sale complete");

    const tab = screen.getByRole("tab");
    expect(tab.textContent).toBe("Order #9 (1) Paid · ₱70");
    expect(tab.className).toContain("bg-ok-tint");
    expect(tab.className).toContain("border-ok-border");
    expect(tab.className).toContain("text-ink");
    expect(tab.className).not.toContain("bg-danger");
  });

  it("renders the day-rollover cue above the rail and clears it on Dismiss", async () => {
    globalThis.fetch = vi.fn(menuFetch()) as typeof fetch;
    // The stale-day guard raises the cue before the POS mounts.
    useOrders.setState({ rolloverCue: true });

    renderPos();
    await screen.findByText("Cortado");

    expect(screen.getByText("New day — Order #1 starts fresh")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByText("New day — Order #1 starts fresh")).toBeNull();
    expect(useOrders.getState().rolloverCue).toBe(false);
    // Non-blocking: the rail stays usable after dismissing.
    expect(screen.getByRole("tab")).toBeDefined();
  });
});
