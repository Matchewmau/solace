import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchLoanPayments } from "../api/finance";
import { formatPeso } from "../lib/formatPeso";

/**
 * Dedicated payment history for one loan (?loan=<id>).
 * Owns the payments read so FinancePage keeps only the inline pay form.
 * Lazy route chunk with the finance fallback (see routes.tsx).
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
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void paymentsQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : payments.length === 0 ? (
          <p className="text-muted">No payments yet.</p>
        ) : (
          <table
            aria-label="Payment history"
            className="w-full border-collapse text-left text-base"
          >
            <thead>
              <tr className="border-b border-ink/20">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Amount
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Paid at
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-ink/10">
                  <td className="py-2 pr-4">
                    {formatPeso(payment.amount_cents)}
                  </td>
                  <td className="py-2">{payment.paid_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
