/**
 * Same-origin finance API fetchers for the /finance page.
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 */

export interface Bill {
  id: number;
  name: string;
  amount_cents: number;
  due_day: number;
  paid: number;
}

export interface Expense {
  id: number;
  date: string;
  category: string;
  amount_cents: number;
  note: string;
}

export interface Payable {
  id: number;
  label: string;
  amount_cents: number;
  due_date: string;
  paid: number;
}

/** Today's UTC date (YYYY-MM-DD), matching the server's overdue ruling. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * OVERDUE badge rule, mirrors GET /api/payables?overdue=1:
 * unpaid AND due_date < today-UTC.
 */
export function isOverdue(
  payable: Pick<Payable, "due_date" | "paid">,
  today: string = utcToday(),
): boolean {
  return payable.paid === 0 && payable.due_date < today;
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

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchBills(): Promise<Bill[]> {
  return requestJson<Bill[]>("/api/bills");
}

export function patchBillPaid(id: number, paid: 0 | 1): Promise<Bill> {
  return patchJson<Bill>(`/api/bills/${id}`, { paid });
}

export function fetchExpenses(): Promise<Expense[]> {
  return requestJson<Expense[]>("/api/expenses");
}

export function postExpense(input: {
  date: string;
  category: string;
  amount_cents: number;
  note?: string;
}): Promise<Expense> {
  return postJson<Expense>("/api/expenses", input);
}

export function fetchPayables(): Promise<Payable[]> {
  return requestJson<Payable[]>("/api/payables");
}

export function patchPayablePaid(id: number, paid: 0 | 1): Promise<Payable> {
  return patchJson<Payable>(`/api/payables/${id}`, { paid });
}
