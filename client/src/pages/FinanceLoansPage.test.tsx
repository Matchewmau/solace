import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinanceLoansPage from "./FinanceLoansPage";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import { utcToday, type Loan } from "../api/finance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

const loans: Loan[] = [
  {
    id: 1,
    lender: "BDO",
    principal_cents: 100000,
    balance_cents: 90000,
    installment_cents: 50000,
    due_date: "2026-11-15",
    due_day: 15,
    frequency: "monthly",
    end_date: "2027-11-15",
    alert_days: 3,
  },
  {
    id: 2,
    lender: "Settled Lender",
    principal_cents: 50000,
    balance_cents: 0,
    installment_cents: 5000,
    due_date: "2026-10-05",
    due_day: 5,
    frequency: "monthly",
    end_date: null,
    alert_days: 5,
  },
];

const paymentsPosted: Array<{ url: string; body: unknown }> = [];
const created: Array<{ url: string; body: unknown }> = [];
let currentLoans: Loan[] = [];
let loansFetches = 0;

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubFetch() {
  paymentsPosted.length = 0;
  created.length = 0;
  loansFetches = 0;
  currentLoans = loans.map((loan) => ({ ...loan }));
  setStoredAuth("solace123");
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/loans" && (!init || init.method === undefined)) {
      loansFetches += 1;
      return ok(currentLoans.map((loan) => ({ ...loan })));
    }
    const paymentsMatch = u.match(/^\/api\/loans\/(\d+)\/payments$/);
    if (paymentsMatch && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { amount_cents: number };
      const id = Number(paymentsMatch[1]);
      paymentsPosted.push({ url: u, body });
      currentLoans = currentLoans.map((loan) =>
        loan.id === id
          ? { ...loan, balance_cents: 40000, due_date: "2026-12-15", due_day: 15 }
          : loan,
      );
      return ok(
        {
          payment: {
            id: 9,
            loan_id: id,
            amount_cents: body.amount_cents,
            paid_at: "2026-10-13 10:00:00",
          },
          balance_cents: 40000,
          due_date: "2026-12-15",
        },
        201,
      );
    }
    if (u === "/api/loans" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created.push({ url: u, body });
      return ok({ id: 99, ...body }, 201);
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FinanceLoansPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("FinanceLoansPage", () => {
  it("shows the Outstanding/Paid badges per balance", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    const owingRow = screen.getByText("BDO").closest("tr") as HTMLElement;
    expect(within(owingRow).getByText("Outstanding").className).toContain(
      "text-danger",
    );

    const settledRow = screen
      .getByText("Settled Lender")
      .closest("tr") as HTMLElement;
    expect(within(settledRow).getByText("Paid").className).toContain("text-ok");
  });

  it("pay dialog prefills the installment and submits postLoanPayment(1, 50000)", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByRole("button", { name: "Pay BDO" }));
    const dialog = screen.getByRole("dialog", { name: "Pay BDO" });
    const amount = within(dialog).getByLabelText(
      "Payment amount in pesos",
    ) as HTMLInputElement;
    // Prefilled with the installment: ₱500 = 50000 cents.
    expect(amount.value).toBe("500");

    fireEvent.submit(within(dialog).getByLabelText("Pay loan form"));

    await vi.waitFor(() => {
      expect(paymentsPosted).toHaveLength(1);
    });
    expect(paymentsPosted[0]).toEqual({
      url: "/api/loans/1/payments",
      body: { amount_cents: 50000 },
    });
  });

  it("refreshes the loan list after a payment so the next due date is visible", async () => {
    stubFetch();
    renderPage();

    const beforeRow = (await screen.findByText("BDO")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(beforeRow).getByText("2026-11-15")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Pay BDO" }));
    const dialog = screen.getByRole("dialog", { name: "Pay BDO" });
    fireEvent.submit(within(dialog).getByLabelText("Pay loan form"));

    await vi.waitFor(() => {
      expect(paymentsPosted).toHaveLength(1);
    });
    expect(loansFetches).toBeGreaterThanOrEqual(2);
    await vi.waitFor(() => {
      const afterRow = screen.getByText("BDO").closest("tr") as HTMLElement;
      expect(within(afterRow).getByText("2026-12-15")).toBeDefined();
    });
  });

  it("History links to the dedicated loan history route", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    expect(
      screen
        .getByRole("link", { name: "View history for BDO" })
        .getAttribute("href"),
    ).toBe("/finance/history?loan=1");
  });

  it("renders the next due date, repeat, alert days, and Until fully paid for a blank end date", async () => {
    stubFetch();
    renderPage();

    const scheduledRow = (await screen.findByText("BDO")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(scheduledRow).getByText("2026-11-15")).toBeDefined();
    expect(within(scheduledRow).getByText("Monthly")).toBeDefined();
    expect(within(scheduledRow).getByText("until 2027-11-15")).toBeDefined();
    expect(within(scheduledRow).getByText("3 days")).toBeDefined();

    const openEndedRow = screen
      .getByText("Settled Lender")
      .closest("tr") as HTMLElement;
    expect(within(openEndedRow).getByText("Until fully paid")).toBeDefined();
    expect(within(openEndedRow).getByText("5 days")).toBeDefined();
  });

  it("adds a loan with due date, repeat, end date, and alert days", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByRole("button", { name: "+ Add loan" }));
    const dialog = screen.getByRole("dialog", { name: "Add loan" });
    const form = within(dialog).getByLabelText(
      "Add loan form",
    ) as HTMLFormElement;

    const dueDate = within(form).getByLabelText("Due date") as HTMLInputElement;
    expect(dueDate.value).toBe(utcToday());

    fireEvent.change(
      form.querySelector('input[name="lender"]') as HTMLInputElement,
      { target: { value: "BPI" } },
    );
    fireEvent.change(
      form.querySelector('input[name="principal"]') as HTMLInputElement,
      { target: { value: "1000" } },
    );
    fireEvent.change(
      form.querySelector('input[name="installment"]') as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(dueDate, { target: { value: "2026-11-20" } });
    fireEvent.change(within(form).getByLabelText("Repeats"), {
      target: { value: "weekly" },
    });
    fireEvent.change(within(form).getByLabelText("Ends on (optional)"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.change(within(form).getByLabelText("Alert days"), {
      target: { value: "6" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "5 days" }));
    expect(
      (within(form).getByLabelText("Alert days") as HTMLInputElement).value,
    ).toBe("5");
    fireEvent.submit(form);

    await vi.waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(created[0]).toEqual({
      url: "/api/loans",
      body: {
        lender: "BPI",
        principal_cents: 100000,
        installment_cents: 10000,
        due_date: "2026-11-20",
        frequency: "weekly",
        end_date: "2026-12-31",
        alert_days: 5,
      },
    });
  });

  it("rejects an end date before the due date without posting", async () => {
    stubFetch();
    renderPage();
    await screen.findByText("BDO");

    fireEvent.click(screen.getByRole("button", { name: "+ Add loan" }));
    const dialog = screen.getByRole("dialog", { name: "Add loan" });
    const form = within(dialog).getByLabelText(
      "Add loan form",
    ) as HTMLFormElement;

    fireEvent.change(
      form.querySelector('input[name="lender"]') as HTMLInputElement,
      { target: { value: "BPI" } },
    );
    fireEvent.change(
      form.querySelector('input[name="principal"]') as HTMLInputElement,
      { target: { value: "1000" } },
    );
    fireEvent.change(
      form.querySelector('input[name="installment"]') as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(within(form).getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(within(form).getByLabelText("Ends on (optional)"), {
      target: { value: "2026-11-30" },
    });
    fireEvent.submit(form);

    expect(
      await screen.findByText("End date must be on or after the due date."),
    ).toBeDefined();
    expect(created).toHaveLength(0);
  });
});
