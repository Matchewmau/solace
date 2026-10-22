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
 * (Monday-Sunday / calendar-month sales, period payment split, ranked best
 * sellers), and the money nuggets (upcoming dues with a status badge, loans
 * summary).
 *
 * Net rules: the month total is the only net. Month net = money in − money
 * out (payments, including salaries, bills, payables, loans, and expenses).
 * Bills, payables, and loans are stocks the owner still owes — listed
 * separately, never subtracted into net. Average/day is the mean of the
 * month's daily sales totals for days that actually had sales.
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

type SalesPeriod = "week" | "month";
type PaymentPeriod = "day" | "week" | "month";
type BestSellerPeriod = "week" | "month";

const SALES_PERIODS: { value: SalesPeriod; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const PAYMENT_PERIODS: { value: PaymentPeriod; label: string }[] = [
  { value: "day", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const BEST_SELLER_PERIODS: { value: BestSellerPeriod; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Weekday label for a date. Week views keep the day-of-month as a second
 * cue; the dense month view uses the weekday alone.
 */
function dayLabel(date: string, period: SalesPeriod): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (!weekday) return date.slice(-2);
  return period === "month" ? weekday : `${weekday} ${date.slice(-2)}`;
}

function emptySalesMessage(period: SalesPeriod): string {
  if (period === "week") return "No sales this week.";
  return "No sales this month.";
}

function emptyPaymentsMessage(period: PaymentPeriod): string {
  if (period === "day") return "No payments today.";
  if (period === "week") return "No payments this week.";
  return "No payments this month.";
}

/**
 * Segmented button group for a chart's period. Selection is exposed through
 * aria-pressed so the control reads as a toggle group.
 */
function PeriodControl<T extends string>({
  ariaLabel,
  periods,
  selected,
  onChange,
}: {
  ariaLabel: string;
  periods: readonly { value: T; label: string }[];
  selected: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 rounded-box border border-ink/15 p-0.5"
    >
      {periods.map((period) => {
        const isSelected = selected === period.value;
        return (
          <button
            key={period.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(period.value)}
            className={`press min-h-11 rounded-[7px] px-3 py-1 text-xs font-semibold ${
              isSelected
                ? "bg-ink text-paper"
                : "text-muted hover:bg-ink/[0.04] hover:text-ink"
            }`}
          >
            {period.label}
          </button>
        );
      })}
    </div>
  );
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
  const [paymentPeriod, setPaymentPeriod] = useState<PaymentPeriod>("month");
  const [bestSellerPeriod, setBestSellerPeriod] =
    useState<BestSellerPeriod>("month");

  const data = dashboardQuery.data;
  // Average the daily totals themselves. Zero-sale days (closed days and
  // days not yet reached) are not part of the divisor.
  const sellingDays = (data?.sales_by_day_month ?? []).filter(
    (day) => day.total_cents > 0,
  );
  const averageDaySale =
    sellingDays.length > 0
      ? Math.round(
          sellingDays.reduce((sum, day) => sum + day.total_cents, 0) /
            sellingDays.length,
        )
      : 0;

  // Both arrays arrive oldest → newest; Bars keeps the caller's order.
  const salesByDay =
    salesPeriod === "week"
      ? data?.sales_by_day_week
      : data?.sales_by_day_month;
  const salesBars = (salesByDay ?? []).map((day) => ({
    label: dayLabel(day.date, salesPeriod),
    value: day.total_cents,
  }));

  const paymentIncome = data
    ? {
        day: data.income_day,
        week: data.income_week,
        month: data.income_month,
      }[paymentPeriod]
    : undefined;

  const paymentSegments = [
    {
      label: "Cash",
      value: paymentIncome?.cash_cents ?? 0,
      color: PAYMENT_COLOR.cash,
    },
    {
      label: "GCash",
      value: paymentIncome?.gcash_cents ?? 0,
      color: PAYMENT_COLOR.gcash,
    },
  ];

  const bestSellerRows =
    bestSellerPeriod === "week"
      ? data?.best_sellers_week
      : data?.best_sellers_month;

  // Ranked by quantity — Bars keeps the caller's order, so sort here.
  const bestSellers = [...(bestSellerRows ?? [])]
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
            Month net is money in minus money out, including salaries, bills,
            payables, loans, and expenses. Average/day is the mean of daily
            sales totals on days with sales.
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
                label="Average/day"
                value={formatPeso(averageDaySale)}
                hint={`${sellingDays.length} selling ${
                  sellingDays.length === 1 ? "day" : "days"
                }`}
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
                  <PeriodControl
                    ariaLabel="Sales period"
                    periods={SALES_PERIODS}
                    selected={salesPeriod}
                    onChange={setSalesPeriod}
                  />
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
              <Box
                title="Payment split"
                action={
                  <PeriodControl
                    ariaLabel="Payment split period"
                    periods={PAYMENT_PERIODS}
                    selected={paymentPeriod}
                    onChange={setPaymentPeriod}
                  />
                }
              >
                <Donut
                  segments={paymentSegments}
                  formatValue={formatPeso}
                  emptyMessage={emptyPaymentsMessage(paymentPeriod)}
                  centerLabel={
                    <div className="flex flex-col items-center">
                      <span className="label text-xs text-muted">Money in</span>
                      <span className="text-lg font-semibold text-ink">
                        {formatPeso(paymentIncome?.total_cents ?? 0)}
                      </span>
                    </div>
                  }
                />
              </Box>
              <Box
                title="Best sellers"
                action={
                  <PeriodControl
                    ariaLabel="Best sellers period"
                    periods={BEST_SELLER_PERIODS}
                    selected={bestSellerPeriod}
                    onChange={setBestSellerPeriod}
                  />
                }
              >
                <Bars
                  items={bestSellers}
                  orientation="horizontal"
                  formatValue={(qty) => `${qty} sold`}
                  emptyMessage={emptySalesMessage(bestSellerPeriod)}
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
                  <Link to="/finance/loans" className="action-link">
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
