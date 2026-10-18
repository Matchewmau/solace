import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchLoans,
  postLoan,
  postLoanPayment,
  type Loan,
} from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import { Reveal } from "../components/motion";
import DataTable, { type Column } from "../components/DataTable";
import { Dialog } from "../components/Dialog";
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
 * Focused loans route (/finance/loans). Loans move out of the long
 * FinancePage into a drill-in page: a DataTable of balances, a per-row Pay
 * dialog (amount defaults to the installment) and a History link to the
 * dedicated /finance/history route, plus a dialog add form. Lazy route
 * chunk — motion allowed.
 */
export default function FinanceLoansPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [payingLoan, setPayingLoan] = useState<Loan | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  const loansQuery = useQuery({
    queryKey: ["loans"],
    queryFn: () => fetchLoans(),
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      lender: string;
      principal_cents: number;
      installment_cents: number;
      due_day: number;
    }) => postLoan(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: () => {
      setAddError("Could not add that loan.");
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
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
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
    { key: "due_day", label: "Due day", render: (loan) => loan.due_day },
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
            className="self-start border border-ink/20 px-3 py-1 text-sm"
          >
            ← Back to finance
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-4xl font-semibold">Loans</h1>
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
            Lenders, balances, and monthly installments.
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
                <Link
                  to={`/finance/history?loan=${loan.id}`}
                  aria-label={`View history for ${loan.lender}`}
                  className="border border-ink/20 px-3 py-1 text-sm"
                >
                  History
                </Link>
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
              className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
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
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add loan">
        <form
          aria-label="Add loan form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const lender = String(data.get("lender") ?? "").trim();
            const principal_cents = Math.round(
              Number(String(data.get("principal") ?? "")) * 100,
            );
            const installment_cents = Math.round(
              Number(String(data.get("installment") ?? "")) * 100,
            );
            const due_day = Number(String(data.get("due_day") ?? ""));
            if (lender === "") return;
            if (!Number.isInteger(principal_cents) || principal_cents < 0)
              return;
            if (!Number.isInteger(installment_cents) || installment_cents <= 0)
              return;
            if (!Number.isInteger(due_day) || due_day < 1 || due_day > 31)
              return;
            addMutation.mutate({
              lender,
              principal_cents,
              installment_cents,
              due_day,
            });
          }}
        >
          <input
            name="lender"
            type="text"
            required
            placeholder="Lender"
            aria-label="Loan lender"
            className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <input
            name="principal"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ principal"
            aria-label="Loan principal in pesos"
            className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <input
            name="installment"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ installment"
            aria-label="Loan installment in pesos"
            className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <input
            name="due_day"
            type="number"
            min="1"
            max="31"
            step="1"
            required
            placeholder="Due day"
            aria-label="Loan due day"
            className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={addMutation.isPending}
            >
              Add loan
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
