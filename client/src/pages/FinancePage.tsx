import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard, type UpcomingDue } from "../api/dashboard";
import { fetchExpenses } from "../api/finance";
import { formatPeso } from "../lib/formatPeso";
import { Donut } from "../components/charts";
import { Badge, Box, Button, PageFrame, StatChip } from "../components/ui";
import {
  Reveal,
  StaggerGroup,
  StaggerItem,
  StaggerList,
  StaggerSection,
} from "../components/motion";
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

/** Where each kind of due lives, so a due row can open its ledger. */
const LEDGER_BY_KIND: Record<UpcomingDue["kind"], string> = {
  bill: "/finance/bills",
  payable: "/finance/payables",
  loan: "/finance/loans",
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** `2026-10` → `October 2026` for the summary header. */
function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  const name = MONTH_NAMES[index];
  return name && month.length >= 7 ? `${name} ${month.slice(0, 4)}` : month;
}

/**
 * Days represented by the month: elapsed days for the current month, the
 * whole month for a past/future month. Keeps the daily average honest on
 * the 3rd of the month instead of dividing by 30.
 */
function elapsedDays(month: string, date: string): number {
  if (date.slice(0, 7) === month) {
    const day = Number(date.slice(8, 10));
    return Number.isFinite(day) && day > 0 ? day : 1;
  }
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  if (!year || !monthIndex) return 1;
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

/** Overdue is danger; the next three days get a neutral due-soon pill. */
function DueBadge({ due }: { due: UpcomingDue }) {
  if (due.overdue) return <Badge tone="danger">Overdue</Badge>;
  if (due.days_until === 0) return <Badge tone="danger">Due today</Badge>;
  if (due.days_until === 1) return <Badge>Due tomorrow</Badge>;
  if (due.days_until <= 3) {
    return <Badge>Due in {due.days_until} days</Badge>;
  }
  return null;
}

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
  const expensesQuery = useQuery({
    queryKey: ["expenses"],
    queryFn: fetchExpenses,
  });

  const data = dashboardQuery.data;
  const month = data?.month ?? "";
  const moneyOut = data?.money_out_month_cents ?? 0;
  const byKind = data?.money_out_month_by_kind;
  const days = elapsedDays(month, data?.date ?? "");
  const dailyAverage = Math.round(moneyOut / days);
  const kindTotals = [
    { label: "Bills", cents: byKind?.bills_cents ?? 0 },
    { label: "Expenses", cents: byKind?.expenses_cents ?? 0 },
    { label: "Payables", cents: byKind?.payables_cents ?? 0 },
    { label: "Loans", cents: byKind?.loans_cents ?? 0 },
    { label: "Salaries", cents: byKind?.salaries_cents ?? 0 },
  ];
  const largestKind = kindTotals.reduce(
    (largest, kind) => (kind.cents > largest.cents ? kind : largest),
    { label: "None", cents: 0 },
  );
  const recentExpenses = [...(expensesQuery.data ?? [])]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.id - a.id;
    })
    .slice(0, 5);
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
          <h1 className="page-title">Finance</h1>
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
            <StaggerSection>
              <Box title={`Cash flow · ${monthLabel(month)}`}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <StatChip
                    label="Money in"
                    value={formatPeso(data.income_month.total_cents)}
                    hint={`${data.income_month.count} sales`}
                  />
                  <StatChip label="Money out" value={formatPeso(moneyOut)} />
                  <StatChip
                    label="Net"
                    value={formatPeso(data.net_month_cents)}
                    tone={data.net_month_cents >= 0 ? "ok" : "danger"}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-ink/10 pt-3 text-sm">
                  <p>
                    <span className="text-muted">Daily average</span>{" "}
                    <span className="font-semibold">
                      {formatPeso(dailyAverage)}
                    </span>{" "}
                    <span className="text-muted">
                      {moneyOut > 0
                        ? `over ${days} days`
                        : "no money out yet"}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted">Largest money out</span>{" "}
                    <span className="font-semibold">
                      {largestKind.label}
                    </span>{" "}
                    <span className="text-muted">
                      {largestKind.cents > 0
                        ? `${formatPeso(largestKind.cents)} of ${formatPeso(moneyOut)}`
                        : "nothing spent yet"}
                    </span>
                  </p>
                </div>
              </Box>
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
            <StaggerSection>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Box title="Upcoming dues">
                  {data.upcoming_dues.length === 0 ? (
                    <p className="text-sm text-muted">
                      Nothing due in the next 7 days.
                    </p>
                  ) : (
                    <StaggerList className="divide-y divide-ink/10">
                      {data.upcoming_dues.map((due, index) => (
                        <StaggerItem
                          key={`${due.kind}-${due.label}-${due.due}-${index}`}
                          className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <Link
                              to={LEDGER_BY_KIND[due.kind]}
                              className="font-semibold underline-offset-2 hover:underline"
                            >
                              {due.label}
                            </Link>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                              <DueBadge due={due} />
                              <span>
                                {due.overdue ? "Was due " : "Due "}
                                <span>{due.due}</span>
                              </span>
                              {!due.overdue && due.days_until > 3 ? (
                                <span>Due in {due.days_until} days</span>
                              ) : null}
                            </div>
                          </div>
                          <p className="shrink-0 font-semibold">
                            {formatPeso(due.amount_cents)}
                          </p>
                        </StaggerItem>
                      ))}
                    </StaggerList>
                  )}
                </Box>
                <Box
                  title="Recent expenses"
                  action={
                    <Link
                      to="/finance/expenses"
                      className="text-sm font-semibold underline-offset-2 hover:underline"
                    >
                      View all
                    </Link>
                  }
                >
                  {expensesQuery.isLoading ? (
                    <p aria-busy="true" className="text-sm text-muted">
                      Loading expenses…
                    </p>
                  ) : expensesQuery.isError ? (
                    <div className="flex flex-col items-start gap-2">
                      <p role="alert" className="text-sm">
                        Could not load recent expenses.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => void expensesQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : recentExpenses.length === 0 ? (
                    <p className="text-sm text-muted">
                      No expenses logged yet.
                    </p>
                  ) : (
                    <StaggerList className="divide-y divide-ink/10">
                      {recentExpenses.map((expense) => (
                        <StaggerItem
                          key={expense.id}
                          className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">{expense.category}</p>
                            {expense.note ? (
                              <p className="text-sm text-muted">{expense.note}</p>
                            ) : null}
                            <p className="text-xs text-muted">{expense.date}</p>
                          </div>
                          <p className="shrink-0 font-semibold">
                            {formatPeso(expense.amount_cents)}
                          </p>
                        </StaggerItem>
                      ))}
                    </StaggerList>
                  )}
                </Box>
              </div>
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
