import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteBill,
  fetchBills,
  patchBill,
  patchBillPaid,
  postBill,
  utcToday,
  type Bill,
  type BillInput,
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
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading bills">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/**
 * One dialog for both add and edit. Fields prefill from `bill` when editing;
 * `null` means a new bill with the usual defaults. Local validation errors
 * stay in the dialog alongside server errors reported by the page.
 */
function BillDialog({
  bill,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  bill: Bill | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: BillInput) => void;
}) {
  const [name, setName] = useState(bill?.name ?? "");
  const [amount, setAmount] = useState(
    bill === null ? "" : String(bill.amount_cents / 100),
  );
  const [dueDate, setDueDate] = useState(bill?.due_date ?? utcToday());
  const [frequency, setFrequency] = useState<"weekly" | "monthly">(
    bill?.frequency ?? "monthly",
  );
  const [endDate, setEndDate] = useState(bill?.end_date ?? "");
  const [alertDays, setAlertDays] = useState(
    bill === null ? "3" : String(bill.alert_days),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const message = localError ?? error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={bill === null ? "Add bill" : `Edit ${bill.name}`}
    >
      <form
        aria-label={bill === null ? "Add bill form" : "Edit bill form"}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedName = name.trim();
          const amount_cents = Math.round(Number(amount) * 100);
          const alert_days = Number(alertDays);
          if (trimmedName === "" || dueDate === "") return;
          if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
          if (
            !Number.isInteger(alert_days) ||
            alert_days < 1 ||
            alert_days > 30
          ) {
            return;
          }
          if (endDate !== "" && endDate < dueDate) {
            setLocalError("End date must be on or after the due date.");
            return;
          }
          setLocalError(null);
          onSubmit({
            name: trimmedName,
            amount_cents,
            due_date: dueDate,
            frequency,
            end_date: endDate === "" ? null : endDate,
            alert_days,
          });
        }}
      >
        <Field label="Bill name">
          <input
            name="name"
            type="text"
            required
            aria-label="Bill name"
            value={name}
            onChange={(event) => setName(event.target.value)}
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
            aria-label="Bill amount in pesos"
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
        <Field label="Repeats">
          <select
            name="frequency"
            value={frequency}
            onChange={(event) =>
              setFrequency(event.target.value as "weekly" | "monthly")
            }
            className="field"
          >
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
        <Field label="Ends on (optional)">
          <input
            name="end_date"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="field"
          />
        </Field>
        <Field label="Alert days">
          <input
            name="alert_days"
            type="number"
            min="1"
            max="30"
            step="1"
            required
            value={alertDays}
            onChange={(event) => setAlertDays(event.target.value)}
            className="field"
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAlertDays("3")}>
            3 days
          </Button>
          <Button variant="outline" onClick={() => setAlertDays("5")}>
            5 days
          </Button>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            {bill === null ? "Add bill" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      {message ? (
        <p role="alert" className="mt-2 text-sm text-accent">
          {message}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * Focused bills route (/finance/bills). Bills, their recurring schedule, and
 * paid status move out of the long FinancePage into a drill-in page with a
 * sortable-free DataTable, row actions, and a shared add/edit dialog.
 * Lazy route chunk — motion import is allowed here.
 */
export default function FinanceBillsPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [deletingBill, setDeletingBill] = useState<Bill | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const billsQuery = useQuery({ queryKey: ["bills"], queryFn: fetchBills });

  function invalidateFinanceQueries() {
    for (const key of ["bills", "dashboard", "due-alerts"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const toggleMutation = useMutation({
    mutationFn: ({ id, next }: { id: number; next: 0 | 1 }) =>
      patchBillPaid(id, next),
    onSuccess: () => {
      setActionError(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not update that bill.",
      );
    },
  });

  const addMutation = useMutation({
    mutationFn: (input: BillInput) => postBill(input),
    onSuccess: () => {
      setActionError(null);
      setAddError(null);
      setAddOpen(false);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setAddError(
        error instanceof Error ? error.message : "Could not add that bill.",
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: BillInput }) =>
      patchBill(id, input),
    onSuccess: () => {
      setEditError(null);
      setEditingBill(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setEditError(
        error instanceof Error ? error.message : "Could not update that bill.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBill(id),
    onSuccess: () => {
      setDeleteError(null);
      setDeletingBill(null);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete that bill.",
      );
    },
  });

  const columns: Column<Bill>[] = [
    { key: "name", label: "Name", render: (bill) => bill.name },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (bill) => formatPeso(bill.amount_cents),
    },
    {
      key: "due_date",
      label: "Due date",
      render: (bill) => bill.due_date,
    },
    {
      key: "frequency",
      label: "Repeats",
      render: (bill) => (
        <div className="flex flex-col">
          <span>{bill.frequency === "weekly" ? "Weekly" : "Monthly"}</span>
          {bill.end_date ? (
            <span className="text-xs text-muted">until {bill.end_date}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "alert_days",
      label: "Alert",
      render: (bill) =>
        `${bill.alert_days} ${bill.alert_days === 1 ? "day" : "days"}`,
    },
    {
      key: "status",
      label: "Status",
      render: (bill) =>
        bill.paid === 1 ? (
          <Badge tone="ok">Paid</Badge>
        ) : (
          <Badge tone="neutral">Unpaid</Badge>
        ),
    },
  ];

  const bills = billsQuery.data ?? [];
  const billDialogOpen = addOpen || editingBill !== null;

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
            <h1 className="page-title">Bills</h1>
            <Button
              variant="primary"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              + Add bill
            </Button>
          </div>
          <p className="text-sm text-muted">
            Recurring bills and their paid status.
          </p>
        </Reveal>
        {actionError ? (
          <p role="alert" className="text-sm text-accent">
            {actionError}
          </p>
        ) : null}
        {billsQuery.isLoading ? (
          <LoadingSkeleton />
        ) : billsQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load bills.
            </p>
            <Button variant="outline" onClick={() => void billsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Bills"
            columns={columns}
            rows={bills}
            rowKey={(bill) => bill.id}
            emptyMessage="No bills recorded."
            renderActions={(bill) =>
              bill.paid === 0 ? (
                <>
                  <Button
                    variant="outline"
                    disabled={toggleMutation.isPending}
                    ariaLabel={`Mark paid for ${bill.name}`}
                    ariaPressed={false}
                    onClick={() =>
                      toggleMutation.mutate({ id: bill.id, next: 1 })
                    }
                  >
                    Mark paid
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditError(null);
                      setEditingBill(bill);
                    }}
                    ariaLabel={`Edit ${bill.name}`}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeleteError(null);
                      setDeletingBill(bill);
                    }}
                    ariaLabel={`Delete ${bill.name}`}
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={toggleMutation.isPending}
                  ariaLabel={`Mark unpaid for ${bill.name}`}
                  ariaPressed
                  onClick={() => toggleMutation.mutate({ id: bill.id, next: 0 })}
                >
                  Mark unpaid
                </Button>
              )
            }
          />
        )}
      </PageFrame>
      {billDialogOpen ? (
        <BillDialog
          key={editingBill === null ? "add" : `edit-${editingBill.id}`}
          bill={editingBill}
          pending={
            editingBill === null
              ? addMutation.isPending
              : editMutation.isPending
          }
          error={editingBill === null ? addError : editError}
          onClose={() => {
            if (editingBill === null) setAddOpen(false);
            else setEditingBill(null);
          }}
          onSubmit={(input) => {
            if (editingBill === null) addMutation.mutate(input);
            else editMutation.mutate({ id: editingBill.id, input });
          }}
        />
      ) : null}
      {deletingBill !== null ? (
        <ConfirmDialog
          open
          title={`Delete ${deletingBill.name}`}
          message="This unpaid occurrence will be removed. A recurring bill will not create its next occurrence."
          confirmLabel="Delete bill"
          pending={deleteMutation.isPending}
          error={deleteError}
          onCancel={() => {
            if (!deleteMutation.isPending) setDeletingBill(null);
          }}
          onConfirm={() => deleteMutation.mutate(deletingBill.id)}
        />
      ) : null}
    </main>
  );
}
