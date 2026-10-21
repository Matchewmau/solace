import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSalaries, postSalary, type Salary } from "../api/finance";
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
      aria-label="Loading salaries"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/**
 * Focused salaries route (/finance/salaries). A Date/Amount sortable
 * DataTable of server-stamped payouts and a dialog add form. Salaries are
 * logged when paid, so the form takes no date. Lazy route chunk — motion
 * allowed.
 */
export default function FinanceSalariesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const salariesQuery = useQuery({
    queryKey: ["salaries"],
    queryFn: fetchSalaries,
  });

  const addMutation = useMutation({
    mutationFn: (input: {
      name: string;
      amount_cents: number;
      note: string;
    }) => postSalary(input),
    onSuccess: () => {
      setAddError(null);
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["salaries"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => {
      setAddError("Could not add that salary.");
    },
  });

  const columns: Column<Salary>[] = [
    {
      key: "date",
      label: "Date",
      sortable: true,
      value: (salary) => salary.paid_at.slice(0, 10),
      render: (salary) => salary.paid_at.slice(0, 10),
    },
    { key: "name", label: "Name", render: (salary) => salary.name },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      align: "right",
      value: (salary) => salary.amount_cents,
      render: (salary) => formatPeso(salary.amount_cents),
    },
    { key: "note", label: "Note", render: (salary) => salary.note },
  ];

  const salaries = salariesQuery.data ?? [];

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
            <h1 className="text-4xl font-semibold">Salaries</h1>
            <Button
              variant="primary"
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              + Add salary
            </Button>
          </div>
          <p className="text-sm text-muted">
            Ledger of salaries paid, newest first.
          </p>
        </Reveal>
        {salariesQuery.isLoading ? (
          <LoadingSkeleton />
        ) : salariesQuery.isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load salaries.
            </p>
            <Button variant="outline" onClick={() => void salariesQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <DataTable
            label="Salaries"
            columns={columns}
            rows={salaries}
            rowKey={(salary) => salary.id}
            emptyMessage="No salaries recorded."
          />
        )}
      </PageFrame>
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add salary"
      >
        <form
          aria-label="Add salary form"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const name = String(data.get("name") ?? "").trim();
            const note = String(data.get("note") ?? "");
            const amount_cents = Math.round(
              Number(String(data.get("amount") ?? "")) * 100,
            );
            if (name === "") return;
            if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
            addMutation.mutate({ name, amount_cents, note });
          }}
        >
          <input
            name="name"
            type="text"
            required
            placeholder="Name"
            aria-label="Salary name"
            className="field"
          />
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ amount"
            aria-label="Salary amount in pesos"
            className="field"
          />
          <input
            name="note"
            type="text"
            placeholder="Note (optional)"
            aria-label="Salary note"
            className="field"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={addMutation.isPending}
            >
              Add salary
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
