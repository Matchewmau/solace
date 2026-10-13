import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchBills,
  fetchExpenses,
  fetchPayables,
  isOverdue,
  patchBillPaid,
  patchPayablePaid,
  postExpense,
  type Bill,
  type Expense,
  type Payable,
} from "../api/finance";
import { formatPeso } from "../lib/formatPeso";

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading finance"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

function PaidToggle({
  label,
  paid,
  pending,
  onToggle,
}: {
  label: string;
  paid: number;
  pending: boolean;
  onToggle: (next: 0 | 1) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={paid === 1}
      disabled={pending}
      onClick={() => onToggle(paid === 1 ? 0 : 1)}
      className="border border-ink/20 px-3 py-1 text-sm"
    >
      {paid === 1 ? "Paid" : "Mark paid"}
    </button>
  );
}

function BillsSection({
  bills,
  pending,
  onToggle,
}: {
  bills: Bill[];
  pending: boolean;
  onToggle: (bill: Bill, next: 0 | 1) => void;
}) {
  return (
    <section aria-label="Bills">
      <p className="label text-xs text-muted">Solace &middot; Bills</p>
      <h2 className="mt-2 text-2xl font-semibold">Bills</h2>
      {bills.length === 0 ? (
        <p className="mt-4 text-muted">No bills recorded.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {bills.map((bill) => (
            <li
              key={bill.id}
              className="flex flex-col gap-1 border-b border-ink/10 pb-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-semibold">{bill.name}</span>
                <span className="text-base">{formatPeso(bill.amount_cents)}</span>
                <span className="text-sm text-muted">
                  due day {bill.due_day}
                </span>
                <span className="ml-auto">
                  <PaidToggle
                    label={`Toggle paid for ${bill.name}`}
                    paid={bill.paid}
                    pending={pending}
                    onToggle={(next) => onToggle(bill, next)}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExpensesSection({
  expenses,
  onAdd,
  pending,
  formError,
}: {
  expenses: Expense[];
  onAdd: (input: {
    date: string;
    category: string;
    amount_cents: number;
    note: string;
  }) => void;
  pending: boolean;
  formError: string | null;
}) {
  return (
    <section aria-label="Expenses">
      <p className="label text-xs text-muted">Solace &middot; Expenses</p>
      <h2 className="mt-2 text-2xl font-semibold">Expenses</h2>
      <form
        aria-label="Add expense"
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const date = String(data.get("date") ?? "");
          const category = String(data.get("category") ?? "").trim();
          const amountRaw = String(data.get("amount") ?? "");
          const note = String(data.get("note") ?? "");
          const amount_cents = Math.round(Number(amountRaw) * 100);
          if (date === "" || category === "") return;
          if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
          onAdd({ date, category, amount_cents, note });
          event.currentTarget.reset();
        }}
      >
        <input
          name="date"
          type="date"
          required
          aria-label="Expense date"
          className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <input
          name="category"
          type="text"
          required
          placeholder="Category"
          aria-label="Expense category"
          className="w-32 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <input
          name="amount"
          type="number"
          min="0"
          step="0.01"
          required
          placeholder="₱ amount"
          aria-label="Expense amount in pesos"
          className="w-28 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <input
          name="note"
          type="text"
          placeholder="Note (optional)"
          aria-label="Expense note"
          className="w-40 border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="border border-ink px-3 py-1 text-sm font-semibold"
        >
          Add expense
        </button>
      </form>
      {formError ? (
        <p role="alert" className="mt-2 text-sm text-accent">
          {formError}
        </p>
      ) : null}
      {expenses.length === 0 ? (
        <p className="mt-4 text-muted">No expenses recorded.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {expenses.map((expense) => (
            <li key={expense.id} className="text-base">
              {expense.date} — {expense.category} —{" "}
              {formatPeso(expense.amount_cents)}
              {expense.note ? ` — ${expense.note}` : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PayablesSection({
  payables,
  pending,
  onToggle,
}: {
  payables: Payable[];
  pending: boolean;
  onToggle: (payable: Payable, next: 0 | 1) => void;
}) {
  return (
    <section aria-label="Payables">
      <p className="label text-xs text-muted">Solace &middot; Payables</p>
      <h2 className="mt-2 text-2xl font-semibold">Payables</h2>
      {payables.length === 0 ? (
        <p className="mt-4 text-muted">Nothing to pay right now.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {payables.map((payable) => (
            <li
              key={payable.id}
              className="flex flex-col gap-1 border-b border-ink/10 pb-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-lg font-semibold">{payable.label}</span>
                <span className="text-base">
                  {formatPeso(payable.amount_cents)}
                </span>
                <span className="text-sm text-muted">
                  due {payable.due_date}
                </span>
                {isOverdue(payable) ? (
                  <span className="border border-accent px-2 py-0.5 text-xs font-semibold text-accent">
                    OVERDUE
                  </span>
                ) : null}
                <span className="ml-auto">
                  <PaidToggle
                    label={`Toggle paid for ${payable.label}`}
                    paid={payable.paid}
                    pending={pending}
                    onToggle={(next) => onToggle(payable, next)}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function FinancePage() {
  const queryClient = useQueryClient();
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const billsQuery = useQuery({ queryKey: ["bills"], queryFn: fetchBills });
  const expensesQuery = useQuery({
    queryKey: ["expenses"],
    queryFn: fetchExpenses,
  });
  const payablesQuery = useQuery({
    queryKey: ["payables"],
    queryFn: fetchPayables,
  });

  const billMutation = useMutation({
    mutationFn: ({ bill, next }: { bill: Bill; next: 0 | 1 }) =>
      patchBillPaid(bill.id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });

  const expenseMutation = useMutation({
    mutationFn: (input: {
      date: string;
      category: string;
      amount_cents: number;
      note: string;
    }) => postExpense(input),
    onSuccess: () => {
      setExpenseError(null);
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: () => {
      setExpenseError("Could not add that expense.");
    },
  });

  const payableMutation = useMutation({
    mutationFn: ({ payable, next }: { payable: Payable; next: 0 | 1 }) =>
      patchPayablePaid(payable.id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payables"] });
    },
  });

  const isLoading =
    billsQuery.isLoading || expensesQuery.isLoading || payablesQuery.isLoading;
  const isError =
    billsQuery.isError || expensesQuery.isError || payablesQuery.isError;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Finance</h1>
          <p className="text-sm text-muted">Bills, expenses, and payables.</p>
        </header>
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load finance.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void billsQuery.refetch();
                void expensesQuery.refetch();
                void payablesQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <BillsSection
              bills={billsQuery.data ?? []}
              pending={billMutation.isPending}
              onToggle={(bill, next) =>
                billMutation.mutate({ bill, next })
              }
            />
            <ExpensesSection
              expenses={expensesQuery.data ?? []}
              pending={expenseMutation.isPending}
              formError={expenseError}
              onAdd={(input) => expenseMutation.mutate(input)}
            />
            <PayablesSection
              payables={payablesQuery.data ?? []}
              pending={payableMutation.isPending}
              onToggle={(payable, next) =>
                payableMutation.mutate({ payable, next })
              }
            />
            {/* Task 12 insertion point: Loans section goes here. */}
          </div>
        )}
      </div>
    </main>
  );
}
