import { useState, type ComponentType } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { BottomSheet } from "./BottomSheet";
import {
  BoxIcon,
  BookIcon,
  CartIcon,
  ChartIcon,
  GridIcon,
  LogoutIcon,
  MoreIcon,
  ReceiptIcon,
  WalletIcon,
  type IconProps,
} from "./icons";

const tabs = [
  { name: "Dashboard", to: "/dashboard" },
  { name: "POS", to: "/pos" },
  { name: "Guide", to: "/guide" },
  { name: "Menu", to: "/menu" },
  { name: "Finance", to: "/finance" },
  { name: "Today", to: "/today" },
  { name: "History", to: "/history" },
  { name: "Inventory", to: "/inventory" },
] as const;

/** The four phone targets: three links + the More trigger. */
const phoneTabs: Array<{
  name: string;
  to: string;
  Icon: ComponentType<IconProps>;
}> = [
  { name: "POS", to: "/pos", Icon: CartIcon },
  { name: "Today", to: "/today", Icon: ReceiptIcon },
  { name: "Money", to: "/finance", Icon: WalletIcon },
];

/** Overflow pages kept off the phone bar, shown in the More sheet. */
const moreTabs: Array<{
  name: string;
  to: string;
  Icon: ComponentType<IconProps>;
}> = [
  { name: "Dashboard", to: "/dashboard", Icon: ChartIcon },
  { name: "Guide", to: "/guide", Icon: BookIcon },
  { name: "Menu", to: "/menu", Icon: GridIcon },
  { name: "History", to: "/history", Icon: ReceiptIcon },
  { name: "Inventory", to: "/inventory", Icon: BoxIcon },
];

function isTabActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  return (to === "/finance" || to === "/inventory") && pathname.startsWith(to);
}

/**
 * Global side rail (md and up) on every authed page. Tabs match the POS rail
 * visual (ink bg, paper text, coffee fill on the current tab). Logout is
 * pinned at the bottom via mt-auto and really logs out. Motion/three-free.
 */
export function SideNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <nav
      aria-label="Pages"
      className="hidden w-24 shrink-0 flex-col items-center gap-3 bg-ink py-6 text-paper md:flex"
    >
      <span className="px-2 text-center text-xs font-bold tracking-widest">
        SOLACE
      </span>
      {tabs.map((tab) => {
        const active = isTabActive(pathname, tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "w-full bg-accent px-2 py-2 text-center text-sm font-semibold text-paper"
                : "w-full px-2 py-2 text-center text-sm font-semibold text-paper/80"
            }
          >
            {tab.name}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onLogout}
        className="mt-auto w-full px-2 py-2 text-center text-sm font-semibold text-paper/60"
      >
        Log out
      </button>
    </nav>
  );
}

/**
 * Phone bottom nav (below md): POS / Today / Money inline, everything else
 * behind a "More pages" sheet. The rail keeps its own logout — the sheet's
 * Log out is additive, not a move. Sits at `bottom-0`; the Task 14 POS cart
 * bar rides `bottom-14` to clear it.
 */
export function BottomNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  function onLogout() {
    setMoreOpen(false);
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-ink/10 bg-paper"
      >
        {phoneTabs.map(({ name, to, Icon: TabIcon }) => {
          const active = isTabActive(pathname, to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={`press flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <TabIcon className="h-5 w-5" />
              {name}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className="press flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted"
        >
          <MoreIcon className="h-5 w-5" />
          More
        </button>
      </nav>
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More pages"
      >
        <nav aria-label="More pages" className="flex flex-col gap-1">
          {moreTabs.map(({ name, to, Icon: TabIcon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => setMoreOpen(false)}
              className="press flex min-h-11 items-center gap-3 rounded-box px-3 text-sm font-semibold text-ink"
            >
              <TabIcon className="h-5 w-5 text-muted" />
              {name}
            </Link>
          ))}
          <button
            type="button"
            onClick={onLogout}
            className="press flex min-h-11 items-center gap-3 rounded-box px-3 text-left text-sm font-semibold text-muted"
          >
            <LogoutIcon className="h-5 w-5" />
            Log out
          </button>
        </nav>
      </BottomSheet>
    </>
  );
}

export function AuthedLayout() {
  return (
    <div className="flex min-h-screen bg-paper text-ink">
      <SideNav />
      <div className="min-w-0 flex-1 pb-14 md:pb-0">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
