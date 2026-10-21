import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboard, type UpcomingDue } from "../api/dashboard";
import { formatPeso } from "../lib/formatPeso";
import { Bars, Donut } from "../components/charts";
import { Badge, Box, Button, EmptyState, PageFrame, StatChip } from "../components/ui";
import { Reveal, StaggerGroup, StaggerSection } from "../components/motion";

/**
 * Owner home screen (/dashboard): the day + month money strip, three charts
 * (Today/Week/Month sales from a 31-day history, month payment split, ranked
 * best sellers), and the money nuggets (upcoming dues with a status badge,
 * loans summary).
 *
 * Net rules: day net = today's sales − today's expenses only. Month net =
 * money in − money out (payments, including salaries, bills, payables,
 * loans, and expenses). Bills, payables, and loans are stocks the owner
 * still owes — listed separately, never subtracted into the day net.
 *
 * Lazy route chunk, so the motion primitives are allowed here.
 */

/** Fixed payment-split colors: Cash coffee, GCash ink. */
const PAYMENT_COLOR = {
  cash: "#8a5a2b",
  gcash: "#141210",
} as const;

const KIND_LABEL: Record<UpcomingDue["kind"], string> = {
  bill: "Bill",
  payable: "Payable",
  loan: "Loan",
};

function daysLabel(days: number): string {
  if (days === 0) return "Due today";
  return `Due in ${days} ${days === 1 ? "day" : "days"}`;
}

type SalesPeriod = "day" | "week" | "month";

const SALES_PERIODS: { value: SalesPeriod; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const PERIOD_DAYS: Record<SalesPeriod, number> = {
  day: 1,
  week: 7,
  month: 31,
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Weekday label for a date. Week and day views keep the day-of-month as a
 * second cue; the dense month view uses the weekday alone.
 */
function dayLabel(date: string, period: SalesPeriod): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (!weekday) return date.slice(-2);
  return period === "month" ? weekday : `${weekday} ${date.slice(-2)}`;
}

function emptySalesMessage(period: SalesPeriod): string {
  if (period === "day") return "No sales today.";
  if (period === "week") return "No sales this week.";
  return "No sales in the last 31 days.";
}

function LoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/** One upcoming due: kind, label, amount, due date, and status badge. */
function DueRow({ due }: { due: UpcomingDue }) {
  const overdue = due.overdue === true;
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="label text-xs text-muted">{KIND_LABEL[due.kind]}</span>
      <span className="font-semibold text-ink">{due.label}</span>
      <span className={overdue ? "text-danger" : "text-ink"}>
        {formatPeso(due.amount_cents)}
      </span>
      <span className="text-muted">due {due.due}</span>
      {overdue ? (
        <Badge tone="danger">Overdue</Badge>
      ) : (
        <Badge>{daysLabel(due.days_until)}</Badge>
      )}
    </li>
  );
}

export default function DashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(),
  });
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod>("week");

  const data = dashboardQuery.data;
  const salesDays = PERIOD_DAYS[salesPeriod];

  // sales_by_day arrives oldest → newest; Bars keeps the caller's order.
  const salesBars = (data?.sales_by_day ?? [])
    .slice(-salesDays)
    .map((day) => ({
      label: dayLabel(day.date, salesPeriod),
      value: day.total_cents,
    }));

  const paymentSegments = [
    {
      label: "Cash",
      value: data?.income_month.cash_cents ?? 0,
      color: PAYMENT_COLOR.cash,
    },
    {
      label: "GCash",
      value: data?.income_month.gcash_cents ?? 0,
      color: PAYMENT_COLOR.gcash,
    },
  ];

  // Ranked by quantity — Bars keeps the caller's order, so sort here.
  const bestSellers = [...(data?.best_sellers ?? [])]
    .sort((a, b) => b.qty - a.qty)
    .map((item) => ({
      label: `${item.name} · ${formatPeso(item.revenue_cents)}`,
      value: item.qty,
    }));

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-muted">
            Day net is today's sales minus today's expenses. Month net is money
            in minus money out, including salaries, bills, payables, loans, and
            expenses.
          </p>
        </Reveal>
        {dashboardQuery.isLoading ? (
          <LoadingSkeleton />
        ) : dashboardQuery.isError || !data ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load the dashboard.
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
              ariaLabel="Money strip"
              className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5"
            >
              <StatChip
                label="Day in"
                value={formatPeso(data.income_day.total_cents)}
              />
              <StatChip
                label="Day net"
                value={formatPeso(data.net_day_cents)}
                tone={data.net_day_cents >= 0 ? "ok" : "danger"}
              />
              <StatChip
                label="Month in"
                value={formatPeso(data.income_month.total_cents)}
              />
              <StatChip
                label="Month out"
                value={formatPeso(data.money_out_month_cents ?? 0)}
              />
              <StatChip
                label="Month net"
                value={formatPeso(data.net_month_cents)}
                tone={data.net_month_cents >= 0 ? "ok" : "danger"}
              />
            </StaggerSection>

            <StaggerSection ariaLabel="Sales overview">
              <Box
                title="Sales"
                action={
                  <div
                    role="group"
                    aria-label="Sales period"
                    className="flex shrink-0 rounded-box border border-ink/15 p-0.5"
                  >
                    {SALES_PERIODS.map((period) => {
                      const selected = salesPeriod === period.value;
                      return (
                        <button
                          key={period.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSalesPeriod(period.value)}
                          className={`press rounded-[7px] px-3 py-1 text-xs font-semibold ${
                            selected
                              ? "bg-ink text-paper"
                              : "text-muted hover:text-ink"
                          }`}
                        >
                          {period.label}
                        </button>
                      );
                    })}
                  </div>
                }
              >
                <div
                  className={
                    salesPeriod === "month" ? "overflow-x-auto pb-1" : ""
                  }
                >
                  <div
                    className={
                      salesPeriod === "month" ? "min-w-[42rem]" : ""
                    }
                  >
                    <Bars
                      items={salesBars}
                      formatValue={formatPeso}
                      showValues={salesPeriod !== "month"}
                      emptyMessage={emptySalesMessage(salesPeriod)}
                    />
                  </div>
                </div>
              </Box>
            </StaggerSection>

            <StaggerSection
              ariaLabel="Charts"
              className="grid grid-cols-1 gap-4 lg:grid-cols-2"
            >
              <Box title="Payment split">
                <Donut
                  segments={paymentSegments}
                  formatValue={formatPeso}
                  emptyMessage="No payments this month."
                  centerLabel={
                    <div className="flex flex-col items-center">
                      <span className="label text-xs text-muted">Money in</span>
                      <span className="text-lg font-semibold text-ink">
                        {formatPeso(data.income_month.total_cents)}
                      </span>
                    </div>
                  }
                />
              </Box>
              <Box title="Best sellers">
                <Bars
                  items={bestSellers}
                  orientation="horizontal"
                  formatValue={(qty) => `${qty} sold`}
                  emptyMessage="No sales this month."
                />
              </Box>
            </StaggerSection>

            <StaggerSection
              ariaLabel="Dues and loans"
              className="grid grid-cols-1 gap-4 lg:grid-cols-2"
            >
              <Box title="Upcoming dues">
                {data.upcoming_dues.length === 0 ? (
                  <EmptyState message="Nothing due right now." />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data.upcoming_dues.map((due, index) => (
                      <DueRow
                        key={`${due.kind}-${due.label}-${due.due}-${index}`}
                        due={due}
                      />
                    ))}
                  </ul>
                )}
              </Box>
              <Box
                title="Loans"
                action={
                  <Link
                    to="/finance/loans"
                    className="press rounded-box border border-ink/20 px-3 py-1 text-sm font-semibold"
                  >
                    Open
                  </Link>
                }
              >
                <p className="text-2xl font-semibold text-ink">
                  {formatPeso(data.outstanding_loans_cents)}
                </p>
                <p className="text-sm text-muted">
                  {data.outstanding_loans_count ?? 0} outstanding
                </p>
              </Box>
            </StaggerSection>
          </StaggerGroup>
        )}
      </PageFrame>
    </main>
  );
}
