import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteLoan,
  fetchLoans,
  patchLoan,
  postLoan,
  postLoanPayment,
  utcToday,
  type Loan,
  type LoanInput,
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
      aria-label="Loading loans"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/**
 * One dialog for both add and edit. Fields prefill from `loan` when editing;
 * `null` means a new loan with the usual defaults. While a loan has payment
 * history its principal and balance are read-only and omitted from the PATCH.
 */
function LoanDialog({
  loan,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  loan: Loan | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: Partial<LoanInput>) => void;
}) {
  const [lender, setLender] = useState(loan?.lender ?? "");
  const [principal, setPrincipal] = useState(
    loan === null ? "" : String(loan.principal_cents / 100),
  );
  const [balance, setBalance] = useState(
    loan === null ? "" : String(loan.balance_cents / 100),
  );
  const [balanceEdited, setBalanceEdited] = useState(false);
  const [installment, setInstallment] = useState(
    loan === null ? "" : String(loan.installment_cents / 100),
  );
  const [dueDate, setDueDate] = useState(loan?.due_date ?? utcToday());
  const [frequency, setFrequency] = useState<"weekly" | "monthly">(
    loan?.frequency ?? "monthly",
  );
  const [endDate, setEndDate] = useState(loan?.end_date ?? "");
  const [alertDays, setAlertDays] = useState(
    loan === null ? "3" : String(loan.alert_days),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const locked = loan !== null && loan.payment_count > 0;
  const message = localError ?? error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={loan === null ? "Add loan" : `Edit ${loan.lender}`}
    >
      <form
        aria-label={loan === null ? "Add loan form" : "Edit loan form"}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedLender = lender.trim();
          const principal_cents = Math.round(Number(principal) * 100);
          const installment_cents = Math.round(Number(installment) * 100);
          const alert_days = Number(alertDays);
          const balanceSource = balance.trim() === "" ? principal : balance;
          const balance_cents = Math.round(Number(balanceSource) * 100);
          if (trimmedLender === "" || dueDate === "") return;
          if (!Number.isInteger(principal_cents) || principal_cents < 0) return;
          if (!Number.isInteger(balance_cents) || balance_cents < 0) return;
          if (!Number.isInteger(installment_cents) || installment_cents <= 0)
            return;
          if (frequency !== "weekly" && frequency !== "monthly") return;
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
          const common: Partial<LoanInput> = {
            lender: trimmedLender,
            installment_cents,
            due_date: dueDate,
            frequency,
            end_date: endDate === "" ? null : endDate,
            alert_days,
          };
          onSubmit(
            locked
              ? common
              : { ...common, principal_cents, balance_cents },
          );
        }}
      >
        <Field label="Lender">
          <input
            name="lender"
            type="text"
            required
            placeholder="Lender"
            aria-label="Loan lender"
            value={lender}
            onChange={(event) => setLender(event.target.value)}
            className="field"
          />
        </Field>
        <Field
          label="Principal (₱)"
          hint={locked ? "Payments lock the principal and balance." : undefined}
        >
          <input
            name="principal"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ principal"
            aria-label="Loan principal in pesos"
            readOnly={locked}
            value={principal}
            onChange={(event) => {
              setPrincipal(event.target.value);
              if (loan === null && !balanceEdited) {
                setBalance(event.target.value);
              }
            }}
            className="field"
          />
        </Field>
        <Field
          label="Current balance (₱)"
          hint="What you still owe today; defaults to the principal."
        >
          <input
            name="balance"
            type="number"
            min="0"
            step="0.01"
            placeholder="₱ balance"
            aria-label="Current balance in pesos"
            readOnly={locked}
            value={balance}
            onChange={(event) => {
              setBalanceEdited(true);
              setBalance(event.target.value);
            }}
            className="field"
          />
        </Field>
        <Field label="Installment (₱)">
          <input
            name="installment"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ installment"
            aria-label="Loan installment in pesos"
            value={installment}
            onChange={(event) => setInstallment(event.target.value)}
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
            {loan === null ? "Add loan" : "Save changes"}
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
 * Focused loans route (/finance/loans). Loans move out of the long
 * FinancePage into a drill-in page: a DataTable of balances, a per-row Pay
 * dialog (amount defaults to the installment) and a History link to the
 * dedicated /finance/history route, plus a shared add/edit dialog. Row
 * actions follow the loan's state: settled loans only link to history, and
 * loans with payment history cannot be deleted.
 */
export default function FinanceLoansPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [payingLoan, setPayingLoan] = useState<Loan | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const loansQuery = useQuery({
    queryKey: ["loans"],
    queryFn: () => fetchLoans(),
  });

  function invalidateFinanceQueries() {
    for (const key of ["loans", "dashboard", "due-alerts"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const addMutation = useMutation({
    mutationFn: (input: LoanInput) => postLoan(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      invalidateFinanceQueries();
    },
    onError: (error) => {
      setAddError(
        error instanceof Error ? error.message : "Could not add that loan.",
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<LoanInput> }) =>
      patchLoan(id, input),
    onSuccess: (_data, variables) => {
      setEditError(null);
      setEditingLoan(null);
      invalidateFinanceQueries();
      void queryClient.invalidateQueries({
        queryKey: ["loan-payments", variables.id],
      });
    },
    onError: (error) => {
      setEditError(
        error instanceof Error ? error.message : "Could not update that loan.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteLoan(id),
    onSuccess: (_data, id) => {
      setDeleteError(null);
      setDeletingLoan(null);
      invalidateFinanceQueries();
      void queryClient.invalidateQueries({
        queryKey: ["loan-payments", id],
      });
    },
    onError: (error) => {
      setDeleteError(
        error instanceof Error ? error.message : "Could not delete that loan.",
      );
    },
  });

  const payMutation = useMutation({
    mutationFn: ({
      loanId,
      amount_cents,
    }: {
      loanId: number;
      amount_cents: number;
    }) => postLoanPayment(loanId, amount_cents),
    onSuccess: (_data, variables) => {
      setPayError(null);
      setPayingLoan(null);
      invalidateFinanceQueries();
      void queryClient.invalidateQueries({
        queryKey: ["loan-payments", variables.loanId],
      });
    },
    onError: () => {
      setPayError("Could not record that payment.");
    },
  });

  const columns: Column<Loan>[] = [
    { key: "lender", label: "Lender", render: (loan) => loan.lender },
    {
      key: "principal",
      label: "Principal",
      align: "right",
      render: (loan) => formatPeso(loan.principal_cents),
    },
    {
      key: "balance",
      label: "Balance",
      align: "right",
      render: (loan) => formatPeso(loan.balance_cents),
    },
    {
      key: "installment",
      label: "Installment",
      align: "right",
      render: (loan) => formatPeso(loan.installment_cents),
    },
    { key: "due_date", label: "Next due", render: (loan) => loan.due_date },
    {
      key: "frequency",
      label: "Repeats",
      render: (loan) => (
        <div className="flex flex-col">
          <span>{loan.frequency === "weekly" ? "Weekly" : "Monthly"}</span>
          <span className="text-xs text-muted">
            {loan.end_date ? `until ${loan.end_date}` : "Until fully paid"}
          </span>
        </div>
      ),
    },
    {
      key: "alert_days",
      label: "Alert",
      render: (loan) =>
        `${loan.alert_days} ${loan.alert_days === 1 ? "day" : "days"}`,
    },
    {
      key: "status",
      label: "Status",
      render: (loan) =>
        loan.balance_cents > 0 ? (
          <Badge tone="danger">Outstanding</Badge>
        ) : (
          <Badge tone="ok">Paid</Badge>
        ),
    },
  ];

  const loans = loansQuery.data ?? [];

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
            <h1 className="page-title">Loans</h1>
            <Button
              variant="primary"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              + Add loan
            </Button>
          </div>
          <p className="text-sm text-muted">
            Lenders, balances, and weekly or monthly installments.
          </p>
        </Reveal>
        {loansQuery.isLoading ? (
          <LoadingSkeleton />
        ) : loansQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load loans.
            </p>
            <Button variant="outline" onClick={() => void loansQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Loans"
            columns={columns}
            rows={loans}
            rowKey={(loan) => loan.id}
            emptyMessage="No loans recorded."
            renderActions={(loan) => (
              <>
                {loan.balance_cents > 0 ? (
                  <Button
                    variant="outline"
                    ariaLabel={`Pay ${loan.lender}`}
                    ariaPressed={payingLoan?.id === loan.id}
                    onClick={() => {
                      setPayError(null);
                      setPayingLoan(loan);
                    }}
                  >
                    Pay
                  </Button>
                ) : null}
                <Link
                  to={`/finance/history?loan=${loan.id}`}
                  aria-label={`View history for ${loan.lender}`}
                  className="action-link"
                >
                  History
                </Link>
                {loan.balance_cents > 0 ? (
                  <Button
                    variant="outline"
                    ariaLabel={`Edit ${loan.lender}`}
                    onClick={() => {
                      setEditError(null);
                      setEditingLoan(loan);
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
                {loan.balance_cents > 0 && loan.payment_count === 0 ? (
                  <Button
                    variant="outline"
                    ariaLabel={`Delete ${loan.lender}`}
                    onClick={() => {
                      setDeleteError(null);
                      setDeletingLoan(loan);
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </>
            )}
          />
        )}
      </PageFrame>
      <Dialog
        open={payingLoan !== null}
        onClose={() => setPayingLoan(null)}
        title={payingLoan ? `Pay ${payingLoan.lender}` : "Pay loan"}
      >
        {payingLoan ? (
          <form
            key={payingLoan.id}
            aria-label="Pay loan form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const amount_cents = Math.round(
                Number(String(data.get("amount") ?? "")) * 100,
              );
              if (!Number.isInteger(amount_cents) || amount_cents <= 0) return;
              payMutation.mutate({
                loanId: payingLoan.id,
                amount_cents,
              });
            }}
          >
            <input
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={payingLoan.installment_cents / 100}
              aria-label="Payment amount in pesos"
              className="field"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={payMutation.isPending}
              >
                Pay {payingLoan.lender}
              </Button>
              <Button variant="outline" onClick={() => setPayingLoan(null)}>
                Cancel
              </Button>
            </div>
            {payError ? (
              <p role="alert" className="text-sm text-accent">
                {payError}
              </p>
            ) : null}
          </form>
        ) : null}
      </Dialog>
      {addOpen || editingLoan !== null ? (
        <LoanDialog
          key={editingLoan === null ? "add" : `edit-${editingLoan.id}`}
          loan={editingLoan}
          pending={
            editingLoan === null
              ? addMutation.isPending
              : editMutation.isPending
          }
          error={editingLoan === null ? addError : editError}
          onClose={() => {
            if (editingLoan === null) setAddOpen(false);
            else setEditingLoan(null);
          }}
          onSubmit={(input) => {
            if (editingLoan === null) addMutation.mutate(input as LoanInput);
            else editMutation.mutate({ id: editingLoan.id, input });
          }}
        />
      ) : null}
      {deletingLoan !== null ? (
        <ConfirmDialog
          open
          title={`Delete ${deletingLoan.lender}`}
          message={`Delete the ${deletingLoan.lender} loan? It has no payment history.`}
          confirmLabel="Delete loan"
          pending={deleteMutation.isPending}
          error={deleteError}
          onCancel={() => {
            if (!deleteMutation.isPending) setDeletingLoan(null);
          }}
          onConfirm={() => deleteMutation.mutate(deletingLoan.id)}
        />
      ) : null}
    </main>
  );
}
