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
  /** true for overdue payables (due before the resolved date); false for bills. */
  overdue?: boolean;
}

export interface MoneyOutByKind {
  bills_cents: number;
  expenses_cents: number;
  payables_cents: number;
  loans_cents: number;
}

export interface SalesByDay {
  date: string;
  total_cents: number;
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
  money_out_day_cents?: number;
  money_out_month_cents?: number;
  money_out_month_by_kind?: MoneyOutByKind;
  /** Exactly 14 entries, oldest → newest, ending at `date`. */
  sales_by_day?: SalesByDay[];
  net_day_cents: number;
  net_month_cents: number;
  unpaid_bills_cents: number;
  unpaid_payables_cents: number;
  unpaid_bills_count?: number;
  unpaid_payables_count?: number;
  overdue_payables_count?: number;
  expenses_month_count?: number;
  outstanding_loans_cents: number;
  outstanding_loans_count?: number;
  upcoming_dues: UpcomingDue[];
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
