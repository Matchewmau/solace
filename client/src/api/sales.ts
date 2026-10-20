/**
 * Same-origin sales API for POS checkout.
 * Payload is exactly {payment, items, paid} — paid rides along as 0|1
 * (open item #2: method + total only; paid tracks settlement, not method).
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 * Every call sends the login credential (x-solace-auth header) and a 401
 * clears the session so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export type PaymentMethod = "cash" | "gcash";

export interface SaleItemPayload {
  menu_item_id: number;
  qty: number;
  /** Chosen variant text, null/omitted when the item has no choices. */
  variant?: string | null;
}

export interface SaleItem {
  id: number;
  menu_item_id: number;
  /** Menu item name joined by GET /api/sales/:id; null if the item vanished. */
  menu_item_name?: string | null;
  qty: number;
  unit_price_cents: number;
  variant: string | null;
}

export interface Sale {
  id: number;
  daily_seq: number;
  total_cents: number;
  payment: PaymentMethod;
  voided: number;
  paid: number;
  /** Cash handed over and change given; null for GCash and pre-change rows. */
  received_cents?: number | null;
  change_cents?: number | null;
  created_at: string;
  items: SaleItem[];
}

/**
 * Row shape from GET /api/sales (no items — the list endpoint returns
 * sale headers only; GET /api/sales/:id returns the full Sale with items).
 */
export interface SaleRow {
  id: number;
  daily_seq: number;
  total_cents: number;
  payment: PaymentMethod;
  voided: number;
  paid: number;
  /** Cash handed over and change given; null for GCash and pre-change rows. */
  received_cents?: number | null;
  change_cents?: number | null;
  created_at: string;
}

export interface SaleSummary {
  date: string;
  cash_total_cents: number;
  gcash_total_cents: number;
  sale_count: number;
  voided_count: number;
  /** Next Order # for the UTC date (day row count + 1, voided included). */
  next_order_number: number;
}

/** Today's UTC date (YYYY-MM-DD), matching the server's day-boundary rule. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${url}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error !== "") {
        message = body.error;
      }
    } catch {
      // Keep the default status message when the body is not JSON.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Today's sales via the server's since/until stamp filters. */
export function fetchSalesForDate(date: string): Promise<SaleRow[]> {
  const query = `since=${encodeURIComponent(date)}&until=${encodeURIComponent(date)}`;
  return requestJson<SaleRow[]>(`/api/sales?${query}`);
}

/** Sales strictly before `date` (History panel) via the server's `until`
 * stamp filter — no new endpoint. The midnight stamp excludes the whole
 * UTC date (shop hours never touch midnight, so `<= date 00:00:00` is
 * exactly "before date"). */
export function fetchPastSales(date: string): Promise<SaleRow[]> {
  return requestJson<SaleRow[]>(
    `/api/sales?until=${encodeURIComponent(`${date} 00:00:00`)}`,
  );
}

export function fetchSummary(date: string): Promise<SaleSummary> {
  return requestJson<SaleSummary>(
    `/api/sales/summary?date=${encodeURIComponent(date)}`,
  );
}

/** Full sale with lines (for reopening an orphaned sale onto a tab). */
export function fetchSale(id: number): Promise<Sale> {
  return requestJson<Sale>(`/api/sales/${id}`);
}

export function patchSaleVoid(id: number, voided: 0 | 1): Promise<Sale> {
  return requestJson<Sale>(`/api/sales/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voided }),
  });
}

/**
 * Hard-delete an unpaid sale (and its lines). The server refuses paid sales,
 * which are financially settled, with 400. Resolves on 204 No Content.
 */
export async function deleteSale(id: number): Promise<void> {
  const res = await authFetch(`/api/sales/${id}`, { method: "DELETE" });
  if (res.ok) return;
  let message = `Request failed: ${res.status} /api/sales/${id}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error !== "") {
      message = body.error;
    }
  } catch {
    // Keep the default status message when the body is not JSON.
  }
  throw new Error(message);
}

/**
 * Settle or un-settle a sale. `receivedCents` (cash handed over) is only
 * sent when provided — the server rejects it unless the effective paid is 1.
 */
export function patchSalePaid(
  id: number,
  paid: 0 | 1,
  receivedCents?: number,
): Promise<Sale> {
  const body: { paid: 0 | 1; received_cents?: number } = { paid };
  if (receivedCents !== undefined) body.received_cents = receivedCents;
  return requestJson<Sale>(`/api/sales/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Replace a sale's lines (finalized-but-unpaid edits). The server
 * re-prices from active menu items and returns the updated Sale. `payment`
 * rides along on Done so an unpaid edit can switch methods; paid sales
 * reject a change server-side. */
export function putSaleItems(
  id: number,
  items: SaleItemPayload[],
  payment?: PaymentMethod,
): Promise<Sale> {
  const body: { items: SaleItemPayload[]; payment?: PaymentMethod } = { items };
  if (payment !== undefined) body.payment = payment;
  return requestJson<Sale>(`/api/sales/${id}/items`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function postSale(
  payment: PaymentMethod,
  items: SaleItemPayload[],
  paid: 0 | 1 = 0,
): Promise<Sale> {
  const res = await authFetch("/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment, items, paid }),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status} /api/sales`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error !== "") {
        message = body.error;
      }
    } catch {
      // Keep the default status message when the body is not JSON.
    }
    throw new Error(message);
  }
  return (await res.json()) as Sale;
}
