import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchLoanPayments, type LoanPayment } from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import DataTable, { type Column } from "../components/DataTable";
import { Button } from "../components/ui";

/**
 * Dedicated payment history for one loan (?loan=<id>).
 * Owns the payments read so FinancePage keeps only the inline pay form.
 * Motion-free ledger on the shared responsive DataTable (row-cards on
 * phones); lazy route chunk with the finance fallback (see routes.tsx).
 */
export default function FinanceHistoryPage() {
  const [params] = useSearchParams();
  const raw = params.get("loan");
  const loanId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;

  const paymentsQuery = useQuery({
    queryKey: ["loan-payments", loanId],
    queryFn: () => fetchLoanPayments(loanId as number),
    enabled: loanId !== null,
  });

  const columns: Column<LoanPayment>[] = [
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      align: "right",
      value: (payment) => payment.amount_cents,
      render: (payment) => formatPeso(payment.amount_cents),
    },
    {
      key: "paid_at",
      label: "Paid at",
      sortable: true,
      value: (payment) => payment.paid_at,
      render: (payment) => payment.paid_at,
    },
  ];

  const payments = paymentsQuery.data ?? [];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Loan history</h1>
          <p className="text-sm text-muted">
            {loanId === null
              ? "Loan payments ledger."
              : `Payments for loan #${loanId}.`}
          </p>
        </header>
        {loanId === null ? (
          <p role="alert" className="text-lg">
            Unknown loan.
          </p>
        ) : paymentsQuery.isLoading ? (
          <p className="text-muted" aria-busy="true">
            Loading history…
          </p>
        ) : paymentsQuery.isError ? (
          <div className="flex flex-col items-start gap-4">
            <p role="alert" className="text-lg">
              Could not load history.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void paymentsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Payment history"
            columns={columns}
            rows={payments}
            rowKey={(payment) => payment.id}
            emptyMessage="No payments yet."
          />
        )}
      </div>
    </main>
  );
}
