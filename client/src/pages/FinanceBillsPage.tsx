import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchBills,
  patchBillPaid,
  postBill,
  utcToday,
  type Bill,
} from "../api/finance";
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
 * Focused bills route (/finance/bills). Bills, their recurring schedule, and
 * paid status move out of the long FinancePage into a drill-in page with a
 * sortable-free DataTable, a row paid toggle, and a dialog add form.
 * Lazy route chunk — motion import is allowed here.
 */
export default function FinanceBillsPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [alertDays, setAlertDays] = useState("3");

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
    mutationFn: (input: {
      name: string;
      amount_cents: number;
      due_date: string;
      frequency: "weekly" | "monthly";
      end_date?: string;
      alert_days: number;
    }) => postBill(input),
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
                setAlertDays("3");
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
            const due_date = String(data.get("due_date") ?? "");
            const frequency = String(data.get("frequency") ?? "monthly");
            const end_date = String(data.get("end_date") ?? "");
            const alert_days = Number(String(data.get("alert_days") ?? ""));
            if (name === "" || due_date === "") return;
            if (!Number.isInteger(amount_cents) || amount_cents < 0) return;
            if (frequency !== "weekly" && frequency !== "monthly") return;
            if (
              !Number.isInteger(alert_days) ||
              alert_days < 1 ||
              alert_days > 30
            ) {
              return;
            }
            if (end_date !== "" && end_date < due_date) {
              setAddError("End date must be on or after the due date.");
              return;
            }
            setAddError(null);
            addMutation.mutate({
              name,
              amount_cents,
              due_date,
              frequency,
              ...(end_date !== "" ? { end_date } : {}),
              alert_days,
            });
          }}
        >
          <input
            name="name"
            type="text"
            required
            placeholder="Bill name"
            aria-label="Bill name"
            className="field"
          />
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            placeholder="₱ amount"
            aria-label="Bill amount in pesos"
            className="field"
          />
          <label className="flex flex-col gap-1 text-sm">
            Due date
            <input
              name="due_date"
              type="date"
              required
              defaultValue={utcToday()}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Repeats
            <select
              name="frequency"
              defaultValue="monthly"
              className="field"
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ends on (optional)
            <input
              name="end_date"
              type="date"
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Alert days
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
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setAlertDays("3")}>
              3 days
            </Button>
            <Button variant="outline" onClick={() => setAlertDays("5")}>
              5 days
            </Button>
          </div>
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
