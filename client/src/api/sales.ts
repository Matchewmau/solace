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
