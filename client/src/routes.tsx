import { Suspense, lazy, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { Navigate, Outlet } from "react-router-dom";
import InventoryPage from "./pages/InventoryPage";
import InventoryHistoryPage from "./pages/InventoryHistoryPage";
import PosPage from "./pages/PosPage";
import TodayPage from "./pages/TodayPage";
import HistoryPage from "./pages/HistoryPage";
import LoginPage from "./pages/LoginPage";
import { AuthedLayout } from "./components/AppHeader";
import { useAuth } from "./components/AuthProvider";
import { PageFrame } from "./components/ui";

/**
 * Binding route table for Tasks 7, 9–14.
 * /menu (Task 6) + /pos (Task 7) + /guide (Task 9) + /inventory (Task 10)
 * + /finance (Task 11) + /dashboard (Task 13) + /showcase (Task 14)
 * + /inventory/history (eager) + /finance/history (lazy with finance)
 * + /finance/{bills,expenses,payables,salaries,loans} (Task 15 drill-ins, lazy).
 * YAGNI — no placeholder pages for future routes.
 *
 * Chunk split (Task 14): motion/three weight must NOT land in the entry
 * chunk. The four motion routes (/menu, /guide, /finance, /dashboard)
 * and /showcase (which owns the lazy three.js scene) are React.lazy
 * route chunks; /finance/history rides the lazy finance chunk too.
 * /pos, /inventory, and /inventory/history stay eager so POS is boring
 * and instant. Every lazy boundary falls back to meaningful brand content,
 * never a spinner. This module (and everything it eagerly imports)
 * must stay motion/three-free — source-grep enforced.
 */

const MenuPage = lazy(() => import("./pages/MenuPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const FinanceHistoryPage = lazy(() => import("./pages/FinanceHistoryPage"));
const FinanceBillsPage = lazy(() => import("./pages/FinanceBillsPage"));
const FinanceExpensesPage = lazy(() => import("./pages/FinanceExpensesPage"));
const FinancePayablesPage = lazy(() => import("./pages/FinancePayablesPage"));
const FinanceSalariesPage = lazy(() => import("./pages/FinanceSalariesPage"));
const FinanceLoansPage = lazy(() => import("./pages/FinanceLoansPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ShowcasePage = lazy(() => import("./pages/ShowcasePage"));

/** Static brand fallback shell for lazy route boundaries. */
function RouteFallback({
  eyebrow,
  title,
  tagline,
}: {
  eyebrow: string;
  title: string;
  tagline: string;
}) {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <div className="flex flex-col gap-3">
          <p className="label text-xs text-muted">{eyebrow}</p>
          <h1 className="text-4xl font-semibold">{title}</h1>
          <p className="text-sm text-muted">{tagline}</p>
        </div>
      </PageFrame>
    </main>
  );
}

function withBrandFallback(
  node: ReactNode,
  fallback: ReactNode,
): ReactNode {
  return <Suspense fallback={fallback}>{node}</Suspense>;
}

const MenuFallback = (
  <RouteFallback
    eyebrow="Cafe"
    title="Solace"
    tagline="Warm espresso, quiet room."
  />
);
const GuideFallback = (
  <RouteFallback
    eyebrow="Cafe"
    title="Barista Guide"
    tagline="Brew steps for every drink."
  />
);
const FinanceFallback = (
  <RouteFallback
    eyebrow="Cafe"
    title="Finance"
    tagline="Bills, expenses, and payables."
  />
);
const DashboardFallback = (
  <RouteFallback
    eyebrow="Cafe"
    title="Dashboard"
    tagline="Month net, average day sale, dues, and best sellers."
  />
);
const ShowcaseFallbackRoute = (
  <RouteFallback
    eyebrow="Solace · Showcase"
    title="Showcase"
    tagline="Warm espresso, quiet room."
  />
);

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AuthedLayout />,
        children: [
          { path: "/", element: <Navigate to="/dashboard" replace /> },
          {
            path: "/dashboard",
            element: withBrandFallback(<DashboardPage />, DashboardFallback),
          },
          { path: "/menu", element: withBrandFallback(<MenuPage />, MenuFallback) },
          { path: "/pos", element: <PosPage /> },
          { path: "/today", element: <TodayPage /> },
          { path: "/history", element: <HistoryPage /> },
          {
            path: "/guide",
            element: withBrandFallback(<GuidePage />, GuideFallback),
          },
          { path: "/inventory", element: <InventoryPage /> },
          { path: "/inventory/history", element: <InventoryHistoryPage /> },
          {
            path: "/finance",
            element: withBrandFallback(<FinancePage />, FinanceFallback),
          },
          {
            path: "/finance/history",
            element: withBrandFallback(
              <FinanceHistoryPage />,
              FinanceFallback,
            ),
          },
          {
            path: "/finance/bills",
            element: withBrandFallback(<FinanceBillsPage />, FinanceFallback),
          },
          {
            path: "/finance/expenses",
            element: withBrandFallback(
              <FinanceExpensesPage />,
              FinanceFallback,
            ),
          },
          {
            path: "/finance/payables",
            element: withBrandFallback(
              <FinancePayablesPage />,
              FinanceFallback,
            ),
          },
          {
            path: "/finance/salaries",
            element: withBrandFallback(
              <FinanceSalariesPage />,
              FinanceFallback,
            ),
          },
          {
            path: "/finance/loans",
            element: withBrandFallback(<FinanceLoansPage />, FinanceFallback),
          },
          {
            path: "/showcase",
            element: withBrandFallback(<ShowcasePage />, ShowcaseFallbackRoute),
          },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
];

/** Logged-out visits bounce to /login; post-login always lands /dashboard. */
function RequireAuth() {
  const { loggedIn } = useAuth();
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
