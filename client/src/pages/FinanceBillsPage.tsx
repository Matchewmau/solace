import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchBills, patchBillPaid, postBill, type Bill } from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import { Reveal } from "../components/motion";
import DataTable, { type Column } from "../components/DataTable";
import { Dialog } from "../components/Dialog";
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
 * Focused bills route (/finance/bills). Bills, their due day, and paid
 * status move out of the long FinancePage into a drill-in page with a
 * sortable-free DataTable, a row paid toggle, and a dialog add form.
 * Lazy route chunk — motion import is allowed here.
 */
export default function FinanceBillsPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const billsQuery = useQuery({ queryKey: ["bills"], queryFn: fetchBills });

  const toggleMutation = useMutation({
    mutationFn: ({ id, next }: { id: number; next: 0 | 1 }) =>
      patchBillPaid(id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      name: string;
      amount_cents: number;
      due_day: number;
    }) => postBill(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: () => {
      setAddError("Could not add that bill.");
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
    { key: "due_day", label: "Due day", render: (bill) => bill.due_day },
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
            <h1 className="text-4xl font-semibold">Bills</h1>
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
            renderActions={(bill) => (
              <Button
                variant="outline"
                disabled={toggleMutation.isPending}
                ariaLabel={`Toggle paid for ${bill.name}`}
                ariaPressed={bill.paid === 1}
                onClick={() =>
                  toggleMutation.mutate({
                    id: bill.id,
                    next: bill.paid === 1 ? 0 : 1,
                  })
                }
              >
                {bill.paid === 1 ? "Paid" : "Mark paid"}
              </Button>
            )}
          />
        )}
      </PageFrame>
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add bill"
      >
        <form
          aria-label="Add bill form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const name = String(data.get("name") ?? "").trim();
            const amount_cents = Math.round(
              Number(String(data.get("amount") ?? "")) * 100,
            );
            const due_day = Number(String(data.get("due_day") ?? ""));
            if (name === "") return;
            if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
            if (!Number.isInteger(due_day) || due_day < 1 || due_day > 31) return;
            addMutation.mutate({ name, amount_cents, due_day });
          }}
        >
          <input
            name="name"
            type="text"
            required
            placeholder="Bill name"
            aria-label="Bill name"
            className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ amount"
            aria-label="Bill amount in pesos"
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
            aria-label="Bill due day"
            className="border border-ink/20 bg-paper px-2 py-1 text-sm text-ink"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={addMutation.isPending}>
              Add bill
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
