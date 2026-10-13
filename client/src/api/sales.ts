/**
 * Same-origin sales API for POS checkout.
 * Payload is exactly {payment, items} — no ref field anywhere,
 * per the spec ruling on GCash (open item #2: method + total only).
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 */

export type PaymentMethod = "cash" | "gcash";

export interface SaleItemPayload {
  menu_item_id: number;
  qty: number;
}

export interface SaleItem {
  id: number;
  menu_item_id: number;
  qty: number;
  unit_price_cents: number;
}

export interface Sale {
  id: number;
  total_cents: number;
  payment: PaymentMethod;
  voided: number;
  created_at: string;
  items: SaleItem[];
}

/**
 * Row shape from GET /api/sales (no items — the list endpoint returns
 * sale headers only; GET /api/sales/:id returns the full Sale with items).
 */
export interface SaleRow {
  id: number;
  total_cents: number;
  payment: PaymentMethod;
  voided: number;
  created_at: string;
}

export interface SaleSummary {
  date: string;
  cash_total_cents: number;
  gcash_total_cents: number;
  sale_count: number;
  voided_count: number;
}

/** Today's UTC date (YYYY-MM-DD), matching the server's day-boundary rule. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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

export function fetchSummary(date: string): Promise<SaleSummary> {
  return requestJson<SaleSummary>(
    `/api/sales/summary?date=${encodeURIComponent(date)}`,
  );
}

export function patchSaleVoid(id: number, voided: 0 | 1): Promise<Sale> {
  return requestJson<Sale>(`/api/sales/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voided }),
  });
}

export async function postSale(
  payment: PaymentMethod,
  items: SaleItemPayload[],
): Promise<Sale> {
  const res = await fetch("/api/sales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment, items }),
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
