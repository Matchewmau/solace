import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPayables,
  isOverdue,
  patchPayablePaid,
  postPayable,
  type Payable,
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
 * Focused payables route (/finance/payables). The supplier ledger moves out
 * of the long FinancePage into a drill-in page. The OVERDUE badge uses the
 * shared isOverdue ruling (unpaid + past due) and takes precedence over
 * Paid/Unpaid. Lazy route chunk — motion allowed.
 */
export default function FinancePayablesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
      invalidateFinanceQueries();
    },
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      label: string;
      amount_cents: number;
      due_date: string;
    }) => postPayable(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      invalidateFinanceQueries();
    },
    onError: () => {
      setAddError("Could not add that payable.");
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
            renderActions={(payable) => (
              <Button
                variant="outline"
                disabled={toggleMutation.isPending}
                ariaLabel={`Toggle paid for ${payable.label}`}
                ariaPressed={payable.paid === 1}
                onClick={() =>
                  toggleMutation.mutate({
                    id: payable.id,
                    next: payable.paid === 1 ? 0 : 1,
                  })
                }
              >
                {payable.paid === 1 ? "Paid" : "Mark paid"}
              </Button>
            )}
          />
        )}
      </PageFrame>
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add payable"
      >
        <form
          aria-label="Add payable form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const label = String(data.get("label") ?? "").trim();
            const amount_cents = Math.round(
              Number(String(data.get("amount") ?? "")) * 100,
            );
            const due_date = String(data.get("due_date") ?? "");
            if (label === "" || due_date === "") return;
            if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
            addMutation.mutate({ label, amount_cents, due_date });
          }}
        >
          <input
            name="label"
            type="text"
            required
            placeholder="Payable label"
            aria-label="Payable label"
            className="field"
          />
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ amount"
            aria-label="Payable amount in pesos"
            className="field"
          />
          <input
            name="due_date"
            type="date"
            required
            aria-label="Payable due date"
            className="field"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={addMutation.isPending}
            >
              Add payable
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
