import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchExpenses,
  postExpense,
  type Expense,
} from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import { Reveal } from "../components/motion";
import DataTable, { type Column } from "../components/DataTable";
import { Dialog } from "../components/Dialog";
import { Button, PageFrame } from "../components/ui";

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading expenses"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/**
 * Focused expenses route (/finance/expenses). The ledger moves out of the
 * long FinancePage into a drill-in page with a Date/Amount sortable
 * DataTable and a dialog add form. Lazy route chunk — motion allowed.
 */
export default function FinanceExpensesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const expensesQuery = useQuery({
    queryKey: ["expenses"],
    queryFn: fetchExpenses,
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      date: string;
      category: string;
      amount_cents: number;
      note: string;
    }) => postExpense(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: () => {
      setAddError("Could not add that expense.");
    },
  });

  const columns: Column<Expense>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      value: (expense) => expense.date,
      render: (expense) => expense.date,
    },
    { key: "category", label: "Category", render: (expense) => expense.category },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      align: "right",
      value: (expense) => expense.amount_cents,
      render: (expense) => formatPeso(expense.amount_cents),
    },
    { key: "note", label: "Note", render: (expense) => expense.note },
  ];

  const expenses = expensesQuery.data ?? [];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <Link
            to="/finance"
            aria-label="Back to finance"
            className="self-start border border-ink/20 px-3 py-1 text-sm"
          >
            ← Back to finance
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="page-title">Expenses</h1>
            <Button
              variant="primary"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              + Add expense
            </Button>
          </div>
          <p className="text-sm text-muted">
            Ledger of spends, newest dates first.
          </p>
        </Reveal>
        {expensesQuery.isLoading ? (
          <LoadingSkeleton />
        ) : expensesQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load expenses.
            </p>
            <Button variant="outline" onClick={() => void expensesQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Expenses"
            columns={columns}
            rows={expenses}
            rowKey={(expense) => expense.id}
            emptyMessage="No expenses recorded."
          />
        )}
      </PageFrame>
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add expense"
      >
        <form
          aria-label="Add expense form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const date = String(data.get("date") ?? "");
            const category = String(data.get("category") ?? "").trim();
            const note = String(data.get("note") ?? "");
            const amount_cents = Math.round(
              Number(String(data.get("amount") ?? "")) * 100,
            );
            if (date === "" || category === "") return;
            if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
            addMutation.mutate({ date, category, amount_cents, note });
          }}
        >
          <input
            name="date"
            type="date"
            required
            aria-label="Expense date"
            className="field"
          />
          <input
            name="category"
            type="text"
            required
            placeholder="Category"
            aria-label="Expense category"
            className="field"
          />
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ amount"
            aria-label="Expense amount in pesos"
            className="field"
          />
          <input
            name="note"
            type="text"
            placeholder="Note (optional)"
            aria-label="Expense note"
            className="field"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={addMutation.isPending}
            >
              Add expense
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
        {addError ? (
          <p role="alert" className="mt-2 text-sm text-accent">
            {addError}
          </p>
        ) : null}
      </Dialog>
    </main>
  );
}
