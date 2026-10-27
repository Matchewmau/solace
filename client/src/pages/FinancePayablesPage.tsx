import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deletePayable,
  fetchPayables,
  isOverdue,
  patchPayable,
  patchPayablePaid,
  postPayable,
  type Payable,
  type PayableInput,
} from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import { Reveal } from "../components/motion";
import DataTable, { type Column } from "../components/DataTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Dialog } from "../components/Dialog";
import { Field } from "../components/Field";
import { Badge, Button, PageFrame } from "../components/ui";

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading payables"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/** Overdue wins over paid-unpaid: danger, then ok, then neutral. */
function payableBadge(payable: Payable) {
  if (isOverdue(payable)) return <Badge tone="danger">Overdue</Badge>;
  if (payable.paid === 1) return <Badge tone="ok">Paid</Badge>;
  return <Badge tone="neutral">Unpaid</Badge>;
}

/**
 * One dialog for both add and edit. Fields prefill from `payable` when
 * editing; `null` means a new payable. Server errors stay in the dialog.
 */
function PayableDialog({
  payable,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  payable: Payable | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: PayableInput) => void;
}) {
  const [label, setLabel] = useState(payable?.label ?? "");
  const [amount, setAmount] = useState(
    payable === null ? "" : String(payable.amount_cents / 100),
  );
  const [dueDate, setDueDate] = useState(payable?.due_date ?? "");

  return (
    <Dialog
      open
      onClose={onClose}
      title={payable === null ? "Add payable" : `Edit ${payable.label}`}
    >
      <form
        aria-label={payable === null ? "Add payable form" : "Edit payable form"}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedLabel = label.trim();
          const amount_cents = Math.round(Number(amount) * 100);
          if (trimmedLabel === "" || dueDate === "") return;
          if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
          onSubmit({
            label: trimmedLabel,
            amount_cents,
            due_date: dueDate,
          });
        }}
      >
        <Field label="Payable label">
          <input
            name="label"
            type="text"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
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
            aria-label="Payable amount in pesos"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="field"
          />
        </Field>
        <Field label="Due date">
          <input
            name="due_date"
            type="date"
            required
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="field"
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {payable === null ? "Add payable" : "Save changes"}
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
 * Focused payables route (/finance/payables). The supplier ledger moves out
 * of the long FinancePage into a drill-in page. The OVERDUE badge uses the
 * shared isOverdue ruling (unpaid + past due) and takes precedence over
 * Paid/Unpaid. Lazy route chunk — motion allowed.
 */
export default function FinancePayablesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingPayable, setEditingPayable] = useState<Payable | null>(null);
  const [deletingPayable, setDeletingPayable] = useState<Payable | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const payablesQuery = useQuery({
    queryKey: ["payables"],
    queryFn: fetchPayables,
  });

  function invalidateFinanceQueries() {
    for (const key of ["payables", "dashboard", "due-alerts"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, next }: { id: number; next: 0 | 1 }) =>
      patchPayablePaid(id, next),
    onSuccess: () => {
      setActionError(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not update that payable.",
      );
    },
  });

  const addMutation = useMutation({
    mutationFn: (input: PayableInput) => postPayable(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setAddError(
        error instanceof Error ? error.message : "Could not add that payable.",
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: PayableInput }) =>
      patchPayable(id, input),
    onSuccess: () => {
      setEditError(null);
      setEditingPayable(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setEditError(
        error instanceof Error
          ? error.message
          : "Could not update that payable.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePayable(id),
    onSuccess: () => {
      setDeleteError(null);
      setDeletingPayable(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Could not delete that payable.",
      );
    },
  });

  const columns: Column<Payable>[] = [
    { key: "label", label: "Label", render: (payable) => payable.label },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (payable) => formatPeso(payable.amount_cents),
    },
    { key: "due_date", label: "Due date", render: (payable) => payable.due_date },
    {
      key: "status",
      label: "Status",
      render: (payable) => payableBadge(payable),
    },
  ];

  const payables = payablesQuery.data ?? [];
  const payableDialogOpen = addOpen || editingPayable !== null;

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
            <h1 className="page-title">Payables</h1>
            <Button
              variant="primary"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              + Add payable
            </Button>
          </div>
          <p className="text-sm text-muted">
            Suppliers to settle, with overdue first.
          </p>
        </Reveal>
        {actionError ? (
          <p role="alert" className="text-sm text-accent">
            {actionError}
          </p>
        ) : null}
        {payablesQuery.isLoading ? (
          <LoadingSkeleton />
        ) : payablesQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load payables.
            </p>
            <Button variant="outline" onClick={() => void payablesQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Payables"
            columns={columns}
            rows={payables}
            rowKey={(payable) => payable.id}
            emptyMessage="Nothing to pay right now."
            renderActions={(payable) =>
              payable.paid === 0 ? (
                <>
                  <Button
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    ariaLabel={`Mark paid for ${payable.label}`}
                    ariaPressed={false}
                    onClick={() =>
                      toggleMutation.mutate({ id: payable.id, next: 1 })
                    }
                  >
                    Mark paid
                  </Button>
                  <Button
                    variant="outline"
                    ariaLabel={`Edit ${payable.label}`}
                    onClick={() => {
                      setEditError(null);
                      setEditingPayable(payable);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    ariaLabel={`Delete ${payable.label}`}
                    onClick={() => {
                      setDeleteError(null);
                      setDeletingPayable(payable);
                    }}
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={toggleMutation.isPending}
                  ariaLabel={`Mark unpaid for ${payable.label}`}
                  ariaPressed
                  onClick={() =>
                    toggleMutation.mutate({ id: payable.id, next: 0 })
                  }
                >
                  Mark unpaid
                </Button>
              )
            }
          />
        )}
      </PageFrame>
      {payableDialogOpen ? (
        <PayableDialog
          key={editingPayable === null ? "add" : `edit-${editingPayable.id}`}
          payable={editingPayable}
          pending={
            editingPayable === null
              ? addMutation.isPending
              : editMutation.isPending
          }
          error={editingPayable === null ? addError : editError}
          onClose={() => {
            if (editingPayable === null) setAddOpen(false);
            else setEditingPayable(null);
          }}
          onSubmit={(input) => {
            if (editingPayable === null) addMutation.mutate(input);
            else editMutation.mutate({ id: editingPayable.id, input });
          }}
        />
      ) : null}
      {deletingPayable !== null ? (
        <ConfirmDialog
          open
          title={`Delete ${deletingPayable.label}`}
          message={`Delete the ${deletingPayable.label} payable of ${formatPeso(
            deletingPayable.amount_cents,
          )}?`}
          confirmLabel="Delete payable"
          pending={deleteMutation.isPending}
          error={deleteError}
          onCancel={() => {
            if (!deleteMutation.isPending) setDeletingPayable(null);
          }}
          onConfirm={() => deleteMutation.mutate(deletingPayable.id)}
        />
      ) : null}
    </main>
  );
}
