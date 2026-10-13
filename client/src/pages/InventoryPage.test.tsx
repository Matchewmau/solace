import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InventoryPage from "./InventoryPage";
import { adjustmentDelta, isLowStock } from "../api/stock";
import type { StockItem, StockMovement } from "../api/stock";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const items: StockItem[] = [
  { id: 1, name: "Milk", unit: "ml", qty: 45, low_threshold: 10 },
  { id: 2, name: "Ice", unit: "", qty: 0, low_threshold: 0 },
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

    const milkRow = screen.getByText("Milk").closest("li") as HTMLElement;
    const historyButton = milkRow.querySelector("button") as HTMLButtonElement;
    fireEvent.click(historyButton);
    expect(await screen.findByText(/waste -5/)).toBeDefined();
  });
});
