import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteExpense,
  fetchExpenses,
  patchExpense,
  postExpense,
  type Expense,
  type ExpenseInput,
} from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import { Reveal } from "../components/motion";
import DataTable, { type Column } from "../components/DataTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Dialog } from "../components/Dialog";
import { Field } from "../components/Field";
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
 * One dialog for both add and edit. Fields prefill from `expense` when
 * editing; `null` means a new expense. Server errors reported by the page
 * stay in the open dialog.
 */
function ExpenseDialog({
  expense,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  expense: Expense | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ExpenseInput) => void;
}) {
  const [date, setDate] = useState(expense?.date ?? "");
  const [category, setCategory] = useState(expense?.category ?? "");
  const [amount, setAmount] = useState(
    expense === null ? "" : String(expense.amount_cents / 100),
  );
  const [note, setNote] = useState(expense?.note ?? "");

  return (
    <Dialog
      open
      onClose={onClose}
      title={expense === null ? "Add expense" : `Edit ${expense.category}`}
    >
      <form
        aria-label={
          expense === null ? "Add expense form" : "Edit expense form"
        }
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedCategory = category.trim();
          const amount_cents = Math.round(Number(amount) * 100);
          if (date === "" || trimmedCategory === "") return;
          if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
          onSubmit({
            date,
            category: trimmedCategory,
            amount_cents,
            note,
          });
        }}
      >
        <Field label="Date">
          <input
            name="date"
            type="date"
            required
            aria-label="Expense date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="field"
          />
        </Field>
        <Field label="Category">
          <input
            name="category"
            type="text"
            required
            aria-label="Expense category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="field"
          />
        </Field>
        <Field label="Amount (₱)">
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            aria-label="Expense amount in pesos"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="field"
          />
        </Field>
        <Field label="Note (optional)">
          <input
            name="note"
            type="text"
            aria-label="Expense note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="field"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {expense === null ? "Add expense" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-accent">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * Focused expenses route (/finance/expenses). The ledger moves out of the
 * long FinancePage into a drill-in page with a Date/Amount sortable
 * DataTable and a shared add/edit dialog. Lazy route chunk — motion allowed.
 */
export default function FinanceExpensesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const expensesQuery = useQuery({
    queryKey: ["expenses"],
    queryFn: fetchExpenses,
  });

  function invalidateFinanceQueries() {
    for (const key of ["expenses", "dashboard"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const addMutation = useMutation({
    mutationFn: (input: ExpenseInput) => postExpense(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setAddError(
        error instanceof Error ? error.message : "Could not add that expense.",
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ExpenseInput }) =>
      patchExpense(id, input),
    onSuccess: () => {
      setEditingError(null);
      setEditingExpense(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setEditingError(
        error instanceof Error
          ? error.message
          : "Could not update that expense.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteExpense(id),
    onSuccess: () => {
      setDeleteError(null);
      setDeletingExpense(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Could not delete that expense.",
      );
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
  const expenseDialogOpen = addOpen || editingExpense !== null;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <Link
            to="/finance"
            aria-label="Back to finance"
            className="back-link self-start"
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
            renderActions={(expense) => (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingError(null);
                    setEditingExpense(expense);
                  }}
                  ariaLabel={`Edit ${expense.category}`}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteError(null);
                    setDeletingExpense(expense);
                  }}
                  ariaLabel={`Delete ${expense.category}`}
                >
                  Delete
                </Button>
              </>
            )}
          />
        )}
      </PageFrame>
      {expenseDialogOpen ? (
        <ExpenseDialog
          key={editingExpense === null ? "add" : `edit-${editingExpense.id}`}
          expense={editingExpense}
          pending={
            editingExpense === null
              ? addMutation.isPending
              : editMutation.isPending
          }
          error={editingExpense === null ? addError : editingError}
          onClose={() => {
            if (editingExpense === null) setAddOpen(false);
            else setEditingExpense(null);
          }}
          onSubmit={(input) => {
            if (editingExpense === null) addMutation.mutate(input);
            else editMutation.mutate({ id: editingExpense.id, input });
          }}
        />
      ) : null}
      {deletingExpense !== null ? (
        <ConfirmDialog
          open
          title={`Delete ${deletingExpense.category}`}
          message={`Delete the ${deletingExpense.category} expense of ${formatPeso(deletingExpense.amount_cents)}?`}
          confirmLabel="Delete expense"
          pending={deleteMutation.isPending}
          error={deleteError}
          onCancel={() => {
            if (!deleteMutation.isPending) setDeletingExpense(null);
          }}
          onConfirm={() => deleteMutation.mutate(deletingExpense.id)}
        />
      ) : null}
    </main>
  );
}
