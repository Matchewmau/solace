/**
 * Same-origin finance API fetchers for the /finance page.
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 * Every call sends the login credential (x-solace-auth header) and a 401
 * clears the session so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export interface Bill {
  id: number;
  name: string;
  amount_cents: number;
  /** UTC due date (YYYY-MM-DD); the schedule source of truth. */
  due_date: string;
  /** @deprecated Compatibility mirror of the day-of-month in due_date. */
  due_day: number;
  frequency: "weekly" | "monthly";
  /** Inclusive last date the series may recur on; null means no end. */
  end_date: string | null;
  /** Days before the due date to surface the bill in due alerts. */
  alert_days: number;
  series_id: number;
  /** Bill that spawned this occurrence; null for the series head. */
  source_bill_id: number | null;
  paid: number;
  /** UTC stamp when settled; null while unpaid. */
  paid_at?: string | null;
}

export interface Expense {
  id: number;
  date: string;
  category: string;
  amount_cents: number;
  note: string;
}

export interface Salary {
  id: number;
  name: string;
  amount_cents: number;
  note: string;
  /** UTC stamp when the payout was logged; set by the server. */
  paid_at: string;
}

export interface Payable {
  id: number;
  label: string;
  amount_cents: number;
  due_date: string;
  paid: number;
  /** UTC stamp when settled; null while unpaid. */
  paid_at?: string | null;
}

export interface Loan {
  id: number;
  lender: string;
  principal_cents: number;
  balance_cents: number;
  installment_cents: number;
  /** UTC due date (YYYY-MM-DD); the schedule source of truth. */
  due_date: string;
  /** @deprecated Compatibility mirror of the day-of-month in due_date. */
  due_day: number;
  frequency: "weekly" | "monthly";
  /** Inclusive last date the series may recur on; null means no end. */
  end_date: string | null;
  /** Days before the due date to surface the loan in due alerts. */
  alert_days: number;
  /** Number of payment rows recorded against the loan. */
  payment_count: number;
}

export interface BillInput {
  name: string;
  amount_cents: number;
  due_date: string;
  frequency: "weekly" | "monthly";
  /** Inclusive last date; null means no end (clears an existing end). */
  end_date?: string | null;
  alert_days: number;
}

export interface ExpenseInput {
  date: string;
  category: string;
  amount_cents: number;
  note?: string;
}

export interface PayableInput {
  label: string;
  amount_cents: number;
  due_date: string;
}

export interface LoanInput {
  lender: string;
  principal_cents: number;
  /** Optional on create: the server starts a fresh loan at its principal. */
  balance_cents?: number;
  installment_cents: number;
  due_date: string;
  frequency: "weekly" | "monthly";
  /** Inclusive last date; null means no end (clears an existing end). */
  end_date?: string | null;
  alert_days: number;
}

export interface LoanPayment {
  id: number;
  loan_id: number;
  amount_cents: number;
  paid_at: string;
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

async function errorMessage(res: Response, url: string): Promise<string> {
  let message = `Request failed: ${res.status} ${url}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error !== "") {
      message = body.error;
    }
  } catch {
    // Keep the default status message when the body is not JSON.
  }
  return message;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, init);
  if (!res.ok) {
    throw new Error(await errorMessage(res, url));
  }
  return (await res.json()) as T;
}

async function deleteJson(url: string): Promise<void> {
  const res = await authFetch(url, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await errorMessage(res, url));
  }
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

export function postBill(input: BillInput): Promise<Bill> {
  return postJson<Bill>("/api/bills", input);
}

export function patchBill(
  id: number,
  input: Partial<BillInput>,
): Promise<Bill> {
  return patchJson<Bill>(`/api/bills/${id}`, input);
}

export function deleteBill(id: number): Promise<void> {
  return deleteJson(`/api/bills/${id}`);
}

export function fetchExpenses(): Promise<Expense[]> {
  return requestJson<Expense[]>("/api/expenses");
}

export function postExpense(input: ExpenseInput): Promise<Expense> {
  return postJson<Expense>("/api/expenses", input);
}

export function patchExpense(
  id: number,
  input: Partial<ExpenseInput>,
): Promise<Expense> {
  return patchJson<Expense>(`/api/expenses/${id}`, input);
}

export function deleteExpense(id: number): Promise<void> {
  return deleteJson(`/api/expenses/${id}`);
}

export function fetchSalaries(): Promise<Salary[]> {
  return requestJson<Salary[]>("/api/salaries");
}

export function postSalary(input: {
  name: string;
  amount_cents: number;
  note?: string;
}): Promise<Salary> {
  return postJson<Salary>("/api/salaries", input);
}

export function fetchPayables(): Promise<Payable[]> {
  return requestJson<Payable[]>("/api/payables");
}

export function patchPayablePaid(id: number, paid: 0 | 1): Promise<Payable> {
  return patchJson<Payable>(`/api/payables/${id}`, { paid });
}

export function postPayable(input: PayableInput): Promise<Payable> {
  return postJson<Payable>("/api/payables", input);
}

export function patchPayable(
  id: number,
  input: Partial<PayableInput>,
): Promise<Payable> {
  return patchJson<Payable>(`/api/payables/${id}`, input);
}

export function deletePayable(id: number): Promise<void> {
  return deleteJson(`/api/payables/${id}`);
}

export function fetchLoans(outstandingOnly = false): Promise<Loan[]> {
  return requestJson<Loan[]>(
    outstandingOnly ? "/api/loans?outstanding=1" : "/api/loans",
  );
}

export function fetchLoanPayments(loanId: number): Promise<LoanPayment[]> {
  return requestJson<LoanPayment[]>(`/api/loans/${loanId}/payments`);
}

export function postLoanPayment(
  loanId: number,
  amount_cents: number,
): Promise<{ payment: LoanPayment; balance_cents: number; due_date: string }> {
  return postJson<{
    payment: LoanPayment;
    balance_cents: number;
    due_date: string;
  }>(`/api/loans/${loanId}/payments`, { amount_cents });
}

export function postLoan(input: LoanInput): Promise<Loan> {
  return postJson<Loan>("/api/loans", input);
}

export function patchLoan(
  id: number,
  input: Partial<LoanInput>,
): Promise<Loan> {
  return patchJson<Loan>(`/api/loans/${id}`, input);
}

export function deleteLoan(id: number): Promise<void> {
  return deleteJson(`/api/loans/${id}`);
}
