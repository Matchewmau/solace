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
}

export type MovementReason = "delivery" | "adjustment" | "waste";

export interface StockMovement {
  id: number;
  stock_item_id: number;
  delta: number;
  reason: MovementReason;
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
    throw new Error(`Request failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
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
): Promise<StockMovement> {
  return postJson<StockMovement>("/api/stock_movements", {
    stock_item_id,
    delta,
    reason,
  });
}

export function postStockItem(input: {
  name: string;
  unit: string;
  qty?: number;
  low_threshold?: number;
}): Promise<StockItem> {
  return postJson<StockItem>("/api/stock_items", input);
}
