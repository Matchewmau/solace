import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SaleDetailDialog from "./SaleDetailDialog";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import type { Sale } from "../api/sales";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const sale: Sale = {
  id: 42,
  daily_seq: 7,
  total_cents: 14000,
  payment: "cash",
  voided: 0,
  paid: 1,
  received_cents: 20000,
  change_cents: 6000,
  created_at: "2026-10-12 14:35:00",
  items: [
    {
      id: 1,
      menu_item_id: 3,
      menu_item_name: "Cortado",
      qty: 2,
      unit_price_cents: 7000,
      variant: "Iced",
    },
  ],
};

function renderDialog(saleId: number | null = 42, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <SaleDetailDialog saleId={saleId} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...view, client, onClose };
}

describe("SaleDetailDialog", () => {
  it("shows each line's name, variant, qty, and total plus payment and status", async () => {
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async (url: unknown) => {
      expect(String(url)).toBe("/api/sales/42");
      return ok(sale);
    }) as typeof fetch;

    const { onClose } = renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Sale #42" });

    expect(within(dialog).getByText("Solace · Sale")).toBeDefined();
    expect(await within(dialog).findByText("2026-10-12 · 14:35")).toBeDefined();
    expect(within(dialog).getByText("Paid")).toBeDefined();
    expect(within(dialog).getByText("Cash")).toBeDefined();
    expect(within(dialog).getByText("Cortado (Iced) × 2")).toBeDefined();
    // Line total and receipt total are both ₱140 for this single line.
    expect(within(dialog).getAllByText("₱140")).toHaveLength(2);
    expect(within(dialog).getByText("Total")).toBeDefined();
    expect(within(dialog).getByText("Received")).toBeDefined();
    expect(within(dialog).getByText("₱200")).toBeDefined();
    expect(within(dialog).getByText("Change")).toBeDefined();
    expect(within(dialog).getByText("₱60")).toBeDefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when closed and shows a retryable error", async () => {
    setStoredAuth("solace123");
    const fetchSpy = vi.fn(async () => ok({ error: "sale not found" }, 404));
    globalThis.fetch = fetchSpy as typeof fetch;

    const { rerender, client } = renderDialog(null);
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <QueryClientProvider client={client}>
        <SaleDetailDialog saleId={42} onClose={() => {}} />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Sale #42" });
    expect(await within(dialog).findByRole("alert")).toHaveProperty(
      "textContent",
      "sale not found",
    );
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeDefined();
  });
});
