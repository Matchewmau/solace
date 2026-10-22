import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InventoryPage from "./InventoryPage";
import { adjustmentDelta, isLowStock } from "../api/stock";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { StockItem, StockMovement } from "../api/stock";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const items: StockItem[] = [
  {
    id: 1,
    name: "Milk",
    unit: "ml",
    qty: 45,
    low_threshold: 10,
    price_cents: 250,
  },
  { id: 2, name: "Ice", unit: "", qty: 0, low_threshold: 0, price_cents: 0 },
];

const posted: Array<{ url: string; body: unknown }> = [];

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function stubFetch() {
  posted.length = 0;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/stock_items" && (!init || init.method === undefined)) {
      return ok(items);
    }
    if (u.startsWith("/api/stock_movements?stock_item_id=")) {
      const id = Number(u.split("=").at(-1));
      const rows: StockMovement[] = [
        { id: 9, stock_item_id: id, delta: -5, reason: "waste", created_at: "2026-10-13 10:00:00" },
      ];
      return ok(rows);
    }
    if (u === "/api/stock_movements" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        stock_item_id: number;
        delta: number;
        reason: string;
      };
      posted.push({ url: u, body });
      return ok(
        { id: 10, ...body, created_at: "2026-10-13 11:00:00" },
        201,
      );
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderInventory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <InventoryPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The StatChip container whose label text is `label`. */
function chip(label: string): HTMLElement {
  return screen.getByText(label).closest("div") as HTMLElement;
}

/** The stock table row whose Item cell reads `name`. */
function row(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

/** Clicks one explicit row movement action and returns the opened dialog. */
function openMovementDialog(
  name: string,
  action: "Delivery" | "Use" | "Count" = "Delivery",
): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: `${action} ${name}` }));
  return screen.findByRole("dialog", { name: `Record movement — ${name}` });
}

function submitMovement(dialog: HTMLElement, name: string) {
  fireEvent.submit(
    within(dialog).getByLabelText(`Record movement for ${name}`).closest(
      "form",
    ) as HTMLFormElement,
  );
}

describe("stock helpers (pure)", () => {
  it("isLowStock flags qty == threshold (boundary) and below, not above", () => {
    expect(isLowStock({ qty: 5, low_threshold: 5 })).toBe(true);
    expect(isLowStock({ qty: 2, low_threshold: 5 })).toBe(true);
    expect(isLowStock({ qty: 6, low_threshold: 5 })).toBe(false);
  });

  it("adjustmentDelta computes newCount - currentQty", () => {
    expect(adjustmentDelta(45, 100)).toBe(55);
    expect(adjustmentDelta(100, 30)).toBe(-70);
  });
});

describe("InventoryPage with mocked data", () => {
  it("renders total value, low stock, and items chips from the fixtures", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    // 45 × ₱2.50 = ₱112.50; Ice is free.
    expect(within(chip("Total value")).getByText("₱112.50")).toBeDefined();
    // Ice (0 <= 0) is the only low row.
    const low = within(chip("Low stock")).getByText("1");
    expect(low.className).toContain("text-danger");
    expect(within(chip("Items")).getByText("2")).toBeDefined();
  });

  it("search narrows the stock rows by name", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.change(screen.getByLabelText("Search stock"), {
      target: { value: "mil" },
    });
    expect(screen.getByText("Milk")).toBeDefined();
    expect(screen.queryByText("Ice")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search stock"), {
      target: { value: "zzz" },
    });
    expect(screen.queryByText("Milk")).toBeNull();
    expect(screen.getByText("No items match your search.")).toBeDefined();
  });

  it("shows a danger Low badge on low rows and a neutral OK otherwise", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const milkRow = row("Milk");
    const okBadge = within(milkRow).getByText("OK");
    expect(okBadge.className).toContain("text-muted");
    expect(within(milkRow).queryByText("Low")).toBeNull();

    const iceRow = row("Ice");
    const lowBadge = within(iceRow).getByText("Low");
    expect(lowBadge.className).toContain("text-danger");
  });

  it("drops the quick −1/+1 buttons and inline movement forms", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    expect(screen.queryByLabelText("Waste one Milk")).toBeNull();
    expect(screen.queryByLabelText("Restock one Milk")).toBeNull();
    expect(screen.queryByLabelText("Deliver Milk")).toBeNull();
    expect(screen.queryByLabelText("Waste Milk")).toBeNull();
    expect(screen.queryByLabelText("Set count Milk")).toBeNull();
  });

  it("records a Delivery through the movement dialog as +qty", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const dialog = await openMovementDialog("Milk");
    // Delivery is the default movement type.
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "2" },
    });
    submitMovement(dialog, "Milk");

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0].body).toEqual({
      stock_item_id: 1,
      delta: 2,
      reason: "delivery",
    });
  });

  it("records a Waste through the movement dialog as −qty", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const dialog = await openMovementDialog("Milk");
    fireEvent.change(within(dialog).getByLabelText("Movement type"), {
      target: { value: "waste" },
    });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "3" },
    });
    submitMovement(dialog, "Milk");

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0].body).toEqual({
      stock_item_id: 1,
      delta: -3,
      reason: "waste",
    });
  });

  it("records Set count as the computed adjustment delta", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const dialog = await openMovementDialog("Milk");
    fireEvent.change(within(dialog).getByLabelText("Movement type"), {
      target: { value: "adjustment" },
    });
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "100" },
    });
    submitMovement(dialog, "Milk");

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    // Milk starts at 45, so a target of 100 records +55.
    expect(posted[0].body).toEqual({
      stock_item_id: 1,
      delta: 55,
      reason: "adjustment",
    });
  });

  it("row History link points at the dedicated history route", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    // The inline history section moved to /inventory/history (own page);
    // the row keeps a plain link there.
    const link = screen.getByRole("link", {
      name: "Show history for Milk",
    });
    expect(link.getAttribute("href")).toBe("/inventory/history?item=1");
    expect(screen.queryByLabelText("History for Milk")).toBeNull();
  });

  it("styles the row History link with the shared action link", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const link = screen.getByRole("link", {
      name: "Show history for Milk",
    });

    // The plan moves route actions onto the shared text-action style; it
    // stays inline-flex through `.action-link` and keeps the icon gap.
    expect(link.className).toContain("action-link");
    expect(link.className).toContain("gap-2");
  });
});

describe("InventoryPage add-item dialog (review fix wave)", () => {
  it("POSTs name/unit/qty/threshold with the auth header", async () => {
    const created: Array<{ url: string; body: unknown; headers: unknown }> = [];
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/stock_items" && (!init || init.method === undefined)) {
        return ok(items);
      }
      if (u === "/api/stock_items" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        created.push({ url: u, body, headers: init.headers });
        return ok({ id: 99, ...body }, 201);
      }
      if (u.startsWith("/api/stock_movements?stock_item_id=")) {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    const dialog = await screen.findByRole("dialog", { name: "Add stock item" });
    const form = within(dialog)
      .getByLabelText("Add stock item form")
      .closest("form") as HTMLFormElement;
    fireEvent.change(
      form.querySelector('input[name="name"]') as HTMLInputElement,
      { target: { value: "Sugar" } },
    );
    fireEvent.change(
      form.querySelector('select[name="unit"]') as HTMLSelectElement,
      { target: { value: "g" } },
    );
    fireEvent.change(form.querySelector('input[name="qty"]') as HTMLInputElement, {
      target: { value: "500" },
    });
    fireEvent.change(
      form.querySelector('input[name="threshold"]') as HTMLInputElement,
      { target: { value: "50" } },
    );
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0].url).toBe("/api/stock_items");
    expect(created[0].body).toEqual({
      name: "Sugar",
      unit: "g",
      qty: 500,
      low_threshold: 50,
    });
    expect(new Headers(created[0].headers as HeadersInit).get("x-solace-auth")).toBe(
      "solace123",
    );
  });

  it("opens from the empty list (fresh DB)", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/stock_items" && (!init || init.method === undefined)) {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderInventory();
    await screen.findByText("No stock items yet");

    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    const dialog = await screen.findByRole("dialog", { name: "Add stock item" });
    expect(within(dialog).getByLabelText("Add stock item form")).toBeDefined();
  });

  it("succeeds with an empty unit", async () => {
    const created: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/stock_items" && (!init || init.method === undefined)) {
        return ok(items);
      }
      if (u === "/api/stock_items" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        created.push({ url: u, body });
        return ok({ id: 99, ...body }, 201);
      }
      if (u.startsWith("/api/stock_movements?stock_item_id=")) {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    const dialog = await screen.findByRole("dialog", { name: "Add stock item" });
    const form = within(dialog)
      .getByLabelText("Add stock item form")
      .closest("form") as HTMLFormElement;
    // Unit is optional on add, matching the edit dialog and server.
    expect(
      (form.querySelector('select[name="unit"]') as HTMLSelectElement).required,
    ).toBe(false);
    fireEvent.change(
      form.querySelector('input[name="name"]') as HTMLInputElement,
      { target: { value: "Beans" } },
    );
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0].body).toEqual({
      name: "Beans",
      unit: "",
      qty: 0,
      low_threshold: 0,
    });
  });
});

describe("InventoryPage price, edit, delete, restock (Task 8)", () => {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  let store: StockItem[];
  let movements: StockMovement[];

  function stubInventoryApi() {
    requests.length = 0;
    store = [
      { id: 1, name: "Milk", unit: "ml", qty: 45, low_threshold: 10, price_cents: 250 },
      { id: 2, name: "Ice", unit: "", qty: 0, low_threshold: 0, price_cents: 7000 },
      { id: 3, name: "Sugar", unit: "g", qty: 100, low_threshold: 5, price_cents: 0 },
    ];
    movements = [
      { id: 9, stock_item_id: 1, delta: -5, reason: "waste", created_at: "2026-10-13 10:00:00" },
    ];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u === "/api/stock_items" && method === "GET") {
        return ok(store);
      }
      if (u.startsWith("/api/stock_movements?stock_item_id=")) {
        const id = Number(u.split("=").at(-1));
        return ok(movements.filter((m) => m.stock_item_id === id));
      }
      if (u === "/api/stock_movements" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          stock_item_id: number;
          delta: number;
          reason: StockMovement["reason"];
        };
        requests.push({ method, url: u, body });
        const row: StockMovement = {
          id: 100 + movements.length,
          ...body,
          created_at: "2026-10-14 09:30:00",
        };
        movements.push(row);
        return ok(row, 201);
      }
      const patchMatch = u.match(/^\/api\/stock_items\/(\d+)$/);
      if (patchMatch && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ method, url: u, body });
        const id = Number(patchMatch[1]);
        store = store.map((item) => (item.id === id ? { ...item, ...body } : item));
        return ok(store.find((item) => item.id === id));
      }
      if (patchMatch && method === "DELETE") {
        const id = Number(patchMatch[1]);
        requests.push({ method, url: u, body: null });
        if (movements.some((m) => m.stock_item_id === id)) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: "stock item has movements" }),
          } as Response;
        }
        store = store.filter((item) => item.id !== id);
        return { ok: true, status: 204, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch ${u} ${method}`);
    }) as typeof fetch;
  }

  it("sums qty × price into the Total value chip (formatPeso)", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Milk");

    // 45 × ₱2.50 = ₱112.50 (Ice and Sugar carry no price).
    expect(within(chip("Total value")).getByText("₱112.50")).toBeDefined();
  });

  it("edit dialog saves name/price/unit/threshold and never edits qty", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByLabelText("Edit Milk"));
    const dialog = await screen.findByRole("dialog", { name: "Edit Milk" });
    // qty is not directly editable: no qty/count field inside the dialog.
    expect(dialog.querySelector('input[name="qty"]')).toBeNull();
    expect(dialog.querySelector('input[name="count"]')).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("Item name"), {
      target: { value: "Oat Milk" },
    });
    fireEvent.change(within(dialog).getByLabelText("Price in pesos"), {
      target: { value: "3.75" },
    });
    fireEvent.change(within(dialog).getByLabelText("Unit"), {
      target: { value: "L" },
    });
    fireEvent.change(within(dialog).getByLabelText("Low threshold"), {
      target: { value: "5" },
    });
    fireEvent.submit(within(dialog).getByLabelText("Edit Milk form").closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]).toEqual({
      method: "PATCH",
      url: "/api/stock_items/1",
      body: { name: "Oat Milk", unit: "L", low_threshold: 5, price_cents: 375 },
    });
    expect("qty" in (requests[0].body as Record<string, unknown>)).toBe(false);

    // Saved values render back: the name on the row, the new price in Total value.
    expect(await screen.findByText("Oat Milk")).toBeDefined();
    await vi.waitFor(() => {
      expect(within(chip("Total value")).getByText("₱168.75")).toBeDefined();
    });
  });

  it("delete removes an item with no history", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Sugar");

    fireEvent.click(screen.getByLabelText("Delete Sugar"));
    fireEvent.click(await screen.findByLabelText("Confirm delete Sugar"));

    await vi.waitFor(() => {
      expect(requests).toContainEqual({
        method: "DELETE",
        url: "/api/stock_items/3",
        body: null,
      });
    });
    await vi.waitFor(() => {
      expect(screen.queryByText("Sugar")).toBeNull();
    });
  });

  it("delete blocked by history shows the server message", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByLabelText("Delete Milk"));
    fireEvent.click(await screen.findByLabelText("Confirm delete Milk"));

    expect(await screen.findByText(/stock item has movements/)).toBeDefined();
    // The row stays: nothing was deleted.
    expect(screen.getByText("Milk")).toBeDefined();
  });

  it("edit saves a row with empty unit without requiring one", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Ice");

    fireEvent.click(screen.getByLabelText("Edit Ice"));
    const dialog = await screen.findByRole("dialog", { name: "Edit Ice" });
    // Unit is optional: empty value submits fine.
    expect((within(dialog).getByLabelText("Unit") as HTMLSelectElement).required).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Item name"), {
      target: { value: "Crushed Ice" },
    });
    fireEvent.submit(within(dialog).getByLabelText("Edit Ice form").closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0]).toEqual({
      method: "PATCH",
      url: "/api/stock_items/2",
      body: { name: "Crushed Ice", unit: "", low_threshold: 0, price_cents: 7000 },
    });
    expect(await screen.findByText("Crushed Ice")).toBeDefined();
  });

  it("edit rejects a fractional threshold without PATCHing", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByLabelText("Edit Milk"));
    const dialog = await screen.findByRole("dialog", { name: "Edit Milk" });
    fireEvent.change(within(dialog).getByLabelText("Low threshold"), {
      target: { value: "5.5" },
    });
    fireEvent.submit(within(dialog).getByLabelText("Edit Milk form").closest("form") as HTMLFormElement);

    // Give the mutation a tick to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toHaveLength(0);
    // Dialog stays open for correction.
    expect(screen.getByRole("dialog", { name: "Edit Milk" })).toBeDefined();
  });
});

describe("InventoryPage standard unit pickers", () => {
  it("add dialog offers the standard units with spelled-out labels", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByRole("button", { name: "+ Add item" }));
    const dialog = await screen.findByRole("dialog", { name: "Add stock item" });
    const unit = within(dialog).getByLabelText("Stock item unit") as HTMLSelectElement;
    expect(unit.tagName).toBe("SELECT");
    const labels = Array.from(unit.querySelectorAll("option")).map((option) =>
      option.textContent?.trim(),
    );
    expect(labels[0]).toBe("No unit");
    expect(labels).toContain("g (grams)");
    expect(labels).toContain("ml (milliliters)");
    expect(labels).toContain("L (liters)");
    expect(labels).toContain("pack");
    expect(labels).toContain("bottle");
    // Defaults to no unit; the operator must pick one.
    expect(unit.value).toBe("");
  });

  it("edit dialog keeps a legacy non-standard unit selectable (no silent rewrite)", async () => {
    const legacy: StockItem = {
      id: 7,
      name: "Sprite",
      unit: "3333",
      qty: 9,
      low_threshold: 0,
      price_cents: 0,
    };
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/stock_items" && (!init || init.method === undefined)) {
        return ok([legacy]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderInventory();
    await screen.findByText("Sprite");

    fireEvent.click(screen.getByLabelText("Edit Sprite"));
    const dialog = await screen.findByRole("dialog", { name: "Edit Sprite" });
    const unit = within(dialog).getByLabelText("Unit") as HTMLSelectElement;
    expect(unit.tagName).toBe("SELECT");
    expect(unit.value).toBe("3333");
  });

  it("shows stored units in their standard short form", async () => {
    const oreo: StockItem = {
      id: 8,
      name: "Oreo",
      unit: "Pack",
      qty: 3,
      low_threshold: 0,
      price_cents: 0,
    };
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/stock_items" && (!init || init.method === undefined)) {
        return ok([oreo]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderInventory();
    await screen.findByText("Oreo");

    expect(await screen.findByText("pack")).toBeDefined();
    expect(screen.queryByText("Pack")).toBeNull();
  });
});

describe("InventoryPage kitchen stock actions (Task 5)", () => {
  it("offers explicit Delivery, Use, and Count actions without recipe links", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    expect(
      screen.getByRole("button", { name: "Delivery Milk" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Use Milk" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Count Milk" })).toBeDefined();

    // Inventory is independent from the menu: no recipe-derived column,
    // sync control, or used-in note anywhere on the page or in the dialog.
    expect(
      screen.queryByRole("columnheader", { name: "Used in" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sync from recipes" }),
    ).toBeNull();
    const countDialog = await openMovementDialog("Milk", "Count");
    expect(within(countDialog).queryByText(/Used in:/)).toBeNull();
    expect(within(countDialog).queryByText("Spanish Latte")).toBeNull();
    expect(
      (within(countDialog).getByLabelText("Movement type") as HTMLSelectElement)
        .value,
    ).toBe("adjustment");
  });

  it("Use presets the used reason and sends the Cafe/Food note with -qty", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const dialog = await openMovementDialog("Milk", "Use");
    expect(
      (within(dialog).getByLabelText("Movement type") as HTMLSelectElement)
        .value,
    ).toBe("used");
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "2" },
    });
    fireEvent.change(within(dialog).getByLabelText("Used for"), {
      target: { value: "2 Spanish Lattes" },
    });
    submitMovement(dialog, "Milk");

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0].body).toEqual({
      stock_item_id: 1,
      delta: -2,
      reason: "used",
      note: "2 Spanish Lattes",
    });
  });

});
