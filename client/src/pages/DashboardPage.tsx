import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchDashboard } from "../api/dashboard";
import { formatPeso } from "../lib/formatPeso";

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

function DashboardNav() {
  const links = [
    { to: "/menu", label: "Menu" },
    { to: "/pos", label: "POS" },
    { to: "/finance", label: "Finance" },
    { to: "/guide", label: "Guide" },
    { to: "/inventory", label: "Inventory" },
  ];
  return (
    <nav aria-label="Dashboard" className="flex flex-wrap gap-4">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="text-sm font-semibold text-accent underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export default function DashboardPage() {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(),
  });

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">
            Net is POS income minus expenses. Unpaid bills, payables, and loans
            are separate lines, never subtracted into net.
          </p>
          <DashboardNav />
        </header>
        {dashboardQuery.isLoading ? (
          <LoadingSkeleton />
        ) : dashboardQuery.isError || !dashboardQuery.data ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load the dashboard.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void dashboardQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <section aria-label="Net">
              <p className="label text-xs text-muted">
                Solace &middot; Net for {dashboardQuery.data.date} /{" "}
                {dashboardQuery.data.month}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Net</h2>
              <p className="mt-4 text-3xl font-semibold">
                Day net {formatPeso(dashboardQuery.data.net_day_cents)}
              </p>
              <p className="mt-2 text-3xl font-semibold">
                Month net {formatPeso(dashboardQuery.data.net_month_cents)}
              </p>
            </section>
            <section aria-label="Income">
              <p className="label text-xs text-muted">Solace &middot; Income</p>
              <h2 className="mt-2 text-2xl font-semibold">Income</h2>
              <ul className="mt-4 flex flex-col gap-2">
                <li className="text-base">
                  Day cash {formatPeso(dashboardQuery.data.income_day.cash_cents)}{" "}
                  &middot; Day GCash{" "}
                  {formatPeso(dashboardQuery.data.income_day.gcash_cents)} &middot;
                  Day total {formatPeso(dashboardQuery.data.income_day.total_cents)}{" "}
                  ({dashboardQuery.data.income_day.count} sales)
                </li>
                <li className="text-base">
                  Month cash{" "}
                  {formatPeso(dashboardQuery.data.income_month.cash_cents)} &middot;
                  Month GCash{" "}
                  {formatPeso(dashboardQuery.data.income_month.gcash_cents)}{" "}
                  &middot; Month total{" "}
                  {formatPeso(dashboardQuery.data.income_month.total_cents)} (
                  {dashboardQuery.data.income_month.count} sales)
                </li>
              </ul>
            </section>
            <section aria-label="Expenses">
              <p className="label text-xs text-muted">Solace &middot; Expenses</p>
              <h2 className="mt-2 text-2xl font-semibold">Expenses</h2>
              <ul className="mt-4 flex flex-col gap-2">
                <li className="text-base">
                  Day {formatPeso(dashboardQuery.data.expenses_day_cents)}
                </li>
                <li className="text-base">
                  Month {formatPeso(dashboardQuery.data.expenses_month_cents)}
                </li>
              </ul>
            </section>
            <section aria-label="Upcoming dues">
              <p className="label text-xs text-muted">
                Solace &middot; Upcoming dues
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Upcoming dues</h2>
              <p className="mt-4 text-base">
                Unpaid bills {formatPeso(dashboardQuery.data.unpaid_bills_cents)}{" "}
                &middot; Unpaid payables{" "}
                {formatPeso(dashboardQuery.data.unpaid_payables_cents)}
              </p>
              {dashboardQuery.data.upcoming_dues.length === 0 ? (
                <p className="mt-4 text-muted">Nothing due right now.</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-2">
                  {dashboardQuery.data.upcoming_dues.map((due, index) => (
                    <li
                      key={`${due.kind}-${due.label}-${due.due}-${index}`}
                      className="text-base"
                    >
                      {due.kind} — {due.label} — {formatPeso(due.amount_cents)} —
                      due {due.due}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Outstanding loans">
              <p className="label text-xs text-muted">
                Solace &middot; Outstanding loans
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Outstanding loans</h2>
              <p className="mt-4 text-base">
                Total {formatPeso(dashboardQuery.data.outstanding_loans_cents)}
              </p>
              {dashboardQuery.data.loans.length === 0 ? (
                <p className="mt-4 text-muted">No outstanding loans.</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-2">
                  {dashboardQuery.data.loans.map((loan) => (
                    <li key={loan.id} className="text-base">
                      {loan.lender} — balance {formatPeso(loan.balance_cents)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Best sellers">
              <p className="label text-xs text-muted">
                Solace &middot; Best sellers
              </p>
              <h2 className="mt-2 text-2xl font-semibold">Best sellers</h2>
              {dashboardQuery.data.best_sellers.length === 0 ? (
                <p className="mt-4 text-muted">No sales this month.</p>
              ) : (
                <ul className="mt-4 flex flex-col gap-2">
                  {dashboardQuery.data.best_sellers.map((item) => (
                    <li key={item.menu_item_id} className="text-base">
                      {item.name} — {item.qty} sold —{" "}
                      {formatPeso(item.revenue_cents)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
