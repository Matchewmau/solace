import { Suspense, lazy, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import InventoryPage from "./pages/InventoryPage";
import PosPage from "./pages/PosPage";

/**
 * Binding route table for Tasks 7, 9–14.
 * /menu (Task 6) + /pos (Task 7) + /guide (Task 9) + /inventory (Task 10)
 * + /finance (Task 11) + /dashboard (Task 13) + /showcase (Task 14).
 * YAGNI — no placeholder pages for future routes.
 *
 * Chunk split (Task 14): motion/three weight must NOT land in the entry
 * chunk. The four motion routes (/menu, /guide, /finance, /dashboard)
 * and /showcase (which owns the lazy three.js scene) are React.lazy
 * route chunks; /pos and /inventory stay eager so POS is boring and
 * instant. Every lazy boundary falls back to meaningful brand content,
 * never a spinner. This module (and everything it eagerly imports)
 * must stay motion/three-free — source-grep enforced.
 */

const MenuPage = lazy(() => import("./pages/MenuPage"));
const GuidePage = lazy(() => import("./pages/GuidePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
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
      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
        <div className="flex flex-col gap-3">
          <p className="label text-xs text-muted">{eyebrow}</p>
          <h1 className="text-4xl font-semibold">{title}</h1>
          <p className="text-sm text-muted">{tagline}</p>
        </div>
      </div>
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
    eyebrow="Cafe · LAN"
    title="Solace"
    tagline="Warm espresso, quiet room."
  />
);
const GuideFallback = (
  <RouteFallback
    eyebrow="Cafe · LAN"
    title="Barista Guide"
    tagline="Brew steps for every drink."
  />
);
const FinanceFallback = (
  <RouteFallback
    eyebrow="Cafe · LAN"
    title="Finance"
    tagline="Bills, expenses, and payables."
  />
);
const DashboardFallback = (
  <RouteFallback
    eyebrow="Cafe · LAN"
    title="Dashboard"
    tagline="Day and month net, dues, and best sellers."
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
  { path: "/", element: <Navigate to="/menu" replace /> },
  {
    path: "/dashboard",
    element: withBrandFallback(<DashboardPage />, DashboardFallback),
  },
  { path: "/menu", element: withBrandFallback(<MenuPage />, MenuFallback) },
  { path: "/pos", element: <PosPage /> },
  {
    path: "/guide",
    element: withBrandFallback(<GuidePage />, GuideFallback),
  },
  { path: "/inventory", element: <InventoryPage /> },
  {
    path: "/finance",
    element: withBrandFallback(<FinancePage />, FinanceFallback),
  },
  {
    path: "/showcase",
    element: withBrandFallback(<ShowcasePage />, ShowcaseFallbackRoute),
  },
  { path: "*", element: <Navigate to="/menu" replace /> },
];
