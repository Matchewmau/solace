import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard } from "../api/dashboard";
import { formatPeso } from "../lib/formatPeso";
import { Donut } from "../components/charts";
import { Badge, Box, Button, PageFrame, StatChip } from "../components/ui";
import { Reveal, StaggerGroup, StaggerSection } from "../components/motion";
import type { ReactNode } from "react";

/**
 * Finance money dashboard (/finance). The long per-ledger lists moved to the
 * drill-in routes in Task 15; this page is the month money view: a
 * money-in / money-out / net strip, a Donut of where the money went, and one
 * quick-link box per ledger. Lazy route chunk — motion imports are allowed.
 */

/** Fixed money-out kind colors (one per donut segment). */
const MONEY_OUT_COLOR = {
  bills: "#8a5a2b",
  expenses: "#141210",
  payables: "#b98a5e",
  loans: "#6f6a61",
  salaries: "#5c6f5a",
} as const;

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading finance"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/** Quick-link box: headline money number, a hint line, and an Open link. */
function DrillBox({
  title,
  value,
  hint,
  to,
  extra,
}: {
  title: string;
  value: string;
  hint: string;
  to: string;
  extra?: ReactNode;
}) {
  return (
    <Box title={title} className="flex h-full flex-col gap-2">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="text-sm text-muted">{hint}</p>
      {extra}
      <Link
        to={to}
        className="press mt-auto self-start rounded-box border border-ink/20 px-3 py-1 text-sm font-semibold"
      >
        Open
      </Link>
    </Box>
  );
}

export default function FinancePage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const data = dashboardQuery.data;
  const month = data?.month ?? "";
  const moneyOut = data?.money_out_month_cents ?? 0;
  const byKind = data?.money_out_month_by_kind;
  const segments = [
    { label: "Bills", value: byKind?.bills_cents ?? 0, color: MONEY_OUT_COLOR.bills },
    {
      label: "Expenses",
      value: byKind?.expenses_cents ?? 0,
      color: MONEY_OUT_COLOR.expenses,
    },
    {
      label: "Payables",
      value: byKind?.payables_cents ?? 0,
      color: MONEY_OUT_COLOR.payables,
    },
    { label: "Loans", value: byKind?.loans_cents ?? 0, color: MONEY_OUT_COLOR.loans },
    {
      label: "Salaries",
      value: byKind?.salaries_cents ?? 0,
      color: MONEY_OUT_COLOR.salaries,
    },
  ];

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="text-4xl font-semibold">Finance</h1>
          <p className="text-sm text-muted">
            Money in vs money out this month, and where it goes.
          </p>
        </Reveal>
        {dashboardQuery.isLoading ? (
          <LoadingSkeleton />
        ) : dashboardQuery.isError || !data ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load finance.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void dashboardQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <StaggerGroup className="flex flex-col gap-10">
            <StaggerSection
              ariaLabel="Summary"
              className="grid grid-cols-1 gap-4 sm:grid-cols-3"
            >
              <StatChip
                label={`Money in · ${month}`}
                value={formatPeso(data.income_month.total_cents)}
                hint={`${data.income_month.count} sales`}
              />
              <StatChip
                label={`Money out · ${month}`}
                value={formatPeso(moneyOut)}
              />
              <StatChip
                label="Net"
                value={formatPeso(data.net_month_cents)}
                tone={data.net_month_cents >= 0 ? "ok" : "danger"}
              />
            </StaggerSection>
            <StaggerSection ariaLabel="Money out breakdown">
              <Box title="Money out by kind">
                <Donut
                  segments={segments}
                  formatValue={formatPeso}
                  centerLabel={
                    <div className="flex flex-col items-center">
                      <span className="label text-xs text-muted">Money out</span>
                      <span className="text-lg font-semibold text-ink">
                        {formatPeso(moneyOut)}
                      </span>
                    </div>
                  }
                />
              </Box>
            </StaggerSection>
            <StaggerSection ariaLabel="Ledgers">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <DrillBox
                  title="Bills"
                  value={formatPeso(data.unpaid_bills_cents)}
                  hint={`${data.unpaid_bills_count ?? 0} unpaid`}
                  to="/finance/bills"
                />
                <DrillBox
                  title="Expenses"
                  value={formatPeso(data.expenses_month_cents)}
                  hint={`${data.expenses_month_count ?? 0} this month`}
                  to="/finance/expenses"
                />
                <DrillBox
                  title="Payables"
                  value={formatPeso(data.unpaid_payables_cents)}
                  hint={`${data.unpaid_payables_count ?? 0} open`}
                  to="/finance/payables"
                  extra={
                    (data.overdue_payables_count ?? 0) > 0 ? (
                      <Badge tone="danger">
                        {data.overdue_payables_count} overdue
                      </Badge>
                    ) : undefined
                  }
                />
                <DrillBox
                  title="Loans"
                  value={formatPeso(data.outstanding_loans_cents)}
                  hint={`${data.outstanding_loans_count ?? 0} outstanding`}
                  to="/finance/loans"
                />
                <DrillBox
                  title="Salaries"
                  value={formatPeso(data.salaries_month_cents ?? 0)}
                  hint={`${data.salaries_month_count ?? 0} paid this month`}
                  to="/finance/salaries"
                />
              </div>
            </StaggerSection>
          </StaggerGroup>
        )}
      </PageFrame>
    </main>
  );
}
