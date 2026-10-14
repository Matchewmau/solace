/**
 * Same-origin dashboard API fetcher for the /dashboard page.
 * Relative URL only — no CDN, no runtime fetches outside /api.
 * Sends the login credential (x-solace-auth header); a 401 clears the
 * session so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export interface IncomeSlice {
  cash_cents: number;
  gcash_cents: number;
  total_cents: number;
  count: number;
}

export interface UpcomingDue {
  kind: "bill" | "payable";
  label: string;
  amount_cents: number;
  due: string;
}

export interface OutstandingLoan {
  id: number;
  lender: string;
  balance_cents: number;
}

export interface BestSeller {
  menu_item_id: number;
  name: string;
  qty: number;
  revenue_cents: number;
}

export interface Dashboard {
  date: string;
  month: string;
  income_day: IncomeSlice;
  income_month: IncomeSlice;
  expenses_day_cents: number;
  expenses_month_cents: number;
  net_day_cents: number;
  net_month_cents: number;
  unpaid_bills_cents: number;
  unpaid_payables_cents: number;
  upcoming_dues: UpcomingDue[];
  outstanding_loans_cents: number;
  loans: OutstandingLoan[];
  best_sellers: BestSeller[];
}

async function requestJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
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

export function fetchDashboard(date?: string, month?: string): Promise<Dashboard> {
  const params = new URLSearchParams();
  if (date !== undefined) params.set("date", date);
  if (month !== undefined) params.set("month", month);
  const qs = params.toString();
  return requestJson<Dashboard>(`/api/dashboard${qs ? `?${qs}` : ""}`);
}
