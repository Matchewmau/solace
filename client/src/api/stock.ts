/**
 * Same-origin stock API fetchers for the /inventory page.
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 * Every call sends the login credential (x-solace-auth header) and a 401
 * clears the session so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export interface StockItem {
  id: number;
  name: string;
  unit: string;
  qty: number;
  low_threshold: number;
  price_cents: number;
  /** Menu items whose recipe uses this ingredient (server-provided). */
  used_in?: string[];
}

export type MovementReason = "delivery" | "used" | "adjustment" | "waste";

/** Human labels shared by the inventory list and its history route. */
export const MOVEMENT_LABELS: Record<MovementReason, string> = {
  delivery: "Delivery",
  used: "Used",
  waste: "Waste",
  adjustment: "Count correction",
};

export interface StockMovement {
  id: number;
  stock_item_id: number;
  delta: number;
  reason: MovementReason;
  note?: string | null;
  /** Joined stock item context (server-provided). */
  item_name?: string;
  item_unit?: string;
  created_at: string;
}

/** LOW badge rule, mirrors GET /api/stock_items?low=1: qty <= low_threshold. */
export function isLowStock(
  item: Pick<StockItem, "qty" | "low_threshold">,
): boolean {
  return item.qty <= item.low_threshold;
}

/**
 * Set-count rule (binds Task 10): the UI never writes qty directly for
 * corrections — it POSTs an adjustment movement with
 * delta = newCount − currentQty.
 */
export function adjustmentDelta(
  currentQty: number,
  newCount: number,
): number {
  return newCount - currentQty;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, url));
  }
  return (await res.json()) as T;
}

async function readApiError(res: Response, url: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") {
      return body.error;
    }
  } catch {
    // Non-JSON body — fall through to the status-based message.
  }
  return `Request failed: ${res.status} ${url}`;
}

export function fetchStockItems(): Promise<StockItem[]> {
  return getJson<StockItem[]>("/api/stock_items");
}

export function fetchMovements(stockItemId: number): Promise<StockMovement[]> {
  return getJson<StockMovement[]>(
    `/api/stock_movements?stock_item_id=${stockItemId}`,
  );
}

export function postStockMovement(
  stock_item_id: number,
  delta: number,
  reason: MovementReason,
  note?: string,
): Promise<StockMovement> {
  const body: {
    stock_item_id: number;
    delta: number;
    reason: MovementReason;
    note?: string;
  } = { stock_item_id, delta, reason };
  const trimmed = note?.trim() ?? "";
  if (trimmed !== "") body.note = trimmed;
  return postJson<StockMovement>("/api/stock_movements", body);
}

/** Create missing ingredient rows from the recipe book. */
export function syncStockFromRecipes(): Promise<{
  created: number;
  skipped: number;
}> {
  return postJson<{ created: number; skipped: number }>(
    "/api/stock_items/sync-recipes",
    {},
  );
}

export function postStockItem(input: {
  name: string;
  unit: string;
  qty?: number;
  low_threshold?: number;
  price_cents?: number;
}): Promise<StockItem> {
  return postJson<StockItem>("/api/stock_items", input);
}

/**
 * Edit a stock item's catalog fields. qty is intentionally NOT accepted —
 * counts only change through the movements ledger (delivery / waste /
 * adjustment), so the UI can never write qty directly.
 */
export function patchStockItem(
  id: number,
  input: {
    name?: string;
    unit?: string;
    low_threshold?: number;
    price_cents?: number;
  },
): Promise<StockItem> {
  return patchJson<StockItem>(`/api/stock_items/${id}`, input);
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, url));
  }
  return (await res.json()) as T;
}

/**
 * Delete a stock item. Rejects with the server message when the row is
 * blocked by history (400 "stock item has movements").
 */
export async function deleteStockItem(id: number): Promise<void> {
  const res = await authFetch(`/api/stock_items/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readApiError(res, `/api/stock_items/${id}`));
  }
}
