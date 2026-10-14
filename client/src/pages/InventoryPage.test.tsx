import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  { id: 1, name: "Milk", unit: "ml", qty: 45, low_threshold: 10, price_cents: 250 },
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
    <QueryClientProvider client={client}>
      <InventoryPage />
    </QueryClientProvider>,
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
  it("renders LOW badges for low items only", async () => {
    stubFetch();
    renderInventory();

    expect(await screen.findByText("Milk")).toBeDefined();
    expect(screen.getByText("Ice")).toBeDefined();
    // Ice (0 <= 0) is LOW in both the low-stock section and the table row.
    expect(screen.getAllByText("LOW").length).toBeGreaterThanOrEqual(2);
    // Milk (45 > 10) has no LOW badge: badges only sit next to low rows.
    const milkRow = screen.getByText("Milk").closest("li") as HTMLElement;
    expect(milkRow.textContent).not.toContain("LOW");
  });

  it("set-count posts an adjustment with delta = newCount - currentQty", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    const setCountForm = screen.getByLabelText("Set count Milk").closest("form") as HTMLFormElement;
    const input = setCountForm.querySelector('input[name="count"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.submit(setCountForm);

    await vi.waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0].body).toEqual({
      stock_item_id: 1,
      delta: 55,
      reason: "adjustment",
    });
  });

  it("shows movement history for the selected item", async () => {
    stubFetch();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByLabelText("Show history for Milk"));
    expect(await screen.findByText(/waste -5/)).toBeDefined();
  });
});

describe("InventoryPage create form (review fix wave)", () => {
  it("add-stock-item form POSTs name/unit/qty/threshold with the auth header", async () => {
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

    const form = screen.getByLabelText("Add stock item").closest(
      "form",
    ) as HTMLFormElement;
    fireEvent.change(
      form.querySelector('input[name="name"]') as HTMLInputElement,
      { target: { value: "Sugar" } },
    );
    fireEvent.change(
      form.querySelector('input[name="unit"]') as HTMLInputElement,
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
    expect(created[0].headers).toMatchObject({ "x-solace-auth": "solace123" });
  });

  it("add-stock-item form shows on an empty list (fresh DB)", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/stock_items" && (!init || init.method === undefined)) {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderInventory();
    await screen.findByText("No stock items yet");
    expect(screen.getByLabelText("Add stock item")).toBeDefined();
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

  it("renders each row price formatted via formatPeso", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Milk");

    const milkRow = screen.getByText("Milk").closest("li") as HTMLElement;
    expect(milkRow.textContent).toContain("₱2.50");
    const iceRow = screen.getByText("Ice").closest("li") as HTMLElement;
    expect(iceRow.textContent).toContain("₱70");
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

    // Saved values render back on the row.
    expect(await screen.findByText("Oat Milk")).toBeDefined();
    expect(await screen.findByText("₱3.75")).toBeDefined();
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
    expect((within(dialog).getByLabelText("Unit") as HTMLInputElement).required).toBe(false);
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

  it("−1 posts waste and +1 posts delivery, both appearing in dated history", async () => {
    stubInventoryApi();
    renderInventory();
    await screen.findByText("Milk");

    fireEvent.click(screen.getByLabelText("Show history for Milk"));
    expect(await screen.findByText(/waste -5/)).toBeDefined();

    fireEvent.click(screen.getByLabelText("Waste one Milk"));
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    expect(requests[0].body).toEqual({
      stock_item_id: 1,
      delta: -1,
      reason: "waste",
    });
    const wasteLine = await screen.findByText(/waste -1/);
    expect(wasteLine.textContent).toContain("2026-10-14");

    fireEvent.click(screen.getByLabelText("Restock one Milk"));
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(requests[1].body).toEqual({
      stock_item_id: 1,
      delta: 1,
      reason: "delivery",
    });
    const deliveryLine = await screen.findByText(/delivery 1/);
    expect(deliveryLine.textContent).toContain("2026-10-14");
  });
});
