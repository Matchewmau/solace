import { useState, type ComponentType } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { BottomSheet } from "./BottomSheet";
import DueAlerts from "./DueAlerts";
import {
  BoxIcon,
  BookIcon,
  CartIcon,
  ChartIcon,
  CupIcon,
  GridIcon,
  LogoutIcon,
  MoreIcon,
  ReceiptIcon,
  WalletIcon,
  type IconProps,
} from "./icons";

const tabs: Array<{ name: string; to: string; Icon: ComponentType<IconProps> }> =
  [
    { name: "Dashboard", to: "/dashboard", Icon: GridIcon },
    { name: "POS", to: "/pos", Icon: CartIcon },
    { name: "Guide", to: "/guide", Icon: BookIcon },
    { name: "Menu", to: "/menu", Icon: CupIcon },
    { name: "Finance", to: "/finance", Icon: ChartIcon },
    { name: "Today", to: "/today", Icon: WalletIcon },
    { name: "History", to: "/history", Icon: ReceiptIcon },
    { name: "Inventory", to: "/inventory", Icon: BoxIcon },
  ];

/** The five phone targets: four links + the More trigger. */
const phoneTabs: Array<{
  name: string;
  to: string;
  Icon: ComponentType<IconProps>;
}> = [
  { name: "Dashboard", to: "/dashboard", Icon: GridIcon },
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
  { name: "Guide", to: "/guide", Icon: BookIcon },
  { name: "Menu", to: "/menu", Icon: CupIcon },
  { name: "History", to: "/history", Icon: ReceiptIcon },
  { name: "Inventory", to: "/inventory", Icon: BoxIcon },
];

function isTabActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  return (to === "/finance" || to === "/inventory") && pathname.startsWith(to);
}

/**
 * Global side rail (md and up) on every authed page: a pinned, full-height
 * frame with the logo in a white tile up top, every tab as an icon-first
 * row (nothing scrolls inside) between it and a pinned Log out. The current
 * page carries a soft accent pill. Logout really logs out. Motion/three-free.
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
      className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col items-center gap-4 overflow-hidden bg-ink px-3 py-6 text-paper md:flex lg:w-56"
    >
      <img
        src="/solace-logo.png"
        alt="Solace Cafe"
        width={480}
        height={244}
        className="h-auto w-24 shrink-0 rounded-box"
      />
      <div className="flex w-full flex-col gap-1.5">
        {tabs.map(({ name, to, Icon: TabIcon }) => {
          const active = isTabActive(pathname, to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={`press focus-paper flex min-h-11 w-full shrink-0 flex-row items-center gap-3 rounded-box px-3 py-2.5 text-[15px] font-semibold ${
                active
                  ? "bg-accent text-paper"
                  : "text-paper/70 hover:bg-paper/10 hover:text-paper"
              }`}
            >
              <TabIcon className="h-5 w-5 shrink-0" />
              {name}
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="press focus-paper mt-auto flex min-h-11 w-full shrink-0 flex-row items-center gap-3 rounded-box px-3 py-2.5 text-[15px] font-semibold text-paper/60 hover:bg-paper/10 hover:text-paper"
      >
        <LogoutIcon className="h-5 w-5 shrink-0" />
        Log out
      </button>
    </nav>
  );
}

const phoneItemBase =
  "press relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold";
const phoneItemActive =
  "text-accent after:absolute after:inset-x-5 after:top-0 after:h-0.5 after:rounded-full after:bg-accent after:content-['']";
const phoneItemInactive = "text-muted hover:text-ink";

/**
 * Phone bottom nav (below md): Dashboard / POS / Today / Money inline, with
 * Guide / Menu / History / Inventory behind a "More pages" sheet. The rail
 * keeps its own logout — the sheet's Log out is additive, not a move. Sits at
 * `bottom-0` at `--bottom-nav-height` (safe-area aware); content and the POS
 * cart bar reserve the same offset.
 */
export function BottomNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = moreTabs.some(({ to }) => isTabActive(pathname, to));

  function onLogout() {
    setMoreOpen(false);
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--bottom-nav-height)] items-stretch border-t border-ink/10 bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {phoneTabs.map(({ name, to, Icon: TabIcon }) => {
          const active = isTabActive(pathname, to);
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={`${phoneItemBase} ${
                active ? phoneItemActive : phoneItemInactive
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
          className={`${phoneItemBase} ${
            moreActive || moreOpen ? phoneItemActive : phoneItemInactive
          }`}
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
          {moreTabs.map(({ name, to, Icon: TabIcon }) => {
            const active = isTabActive(pathname, to);
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? "page" : undefined}
                onClick={() => setMoreOpen(false)}
                className={`press flex min-h-11 items-center gap-3 rounded-box px-3 text-sm font-semibold hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04] ${
                  active ? "text-accent" : "text-ink"
                }`}
              >
                <TabIcon className="h-5 w-5 text-muted" />
                {name}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={onLogout}
            className="press flex min-h-11 items-center gap-3 rounded-box px-3 text-left text-sm font-semibold text-muted hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04]"
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
      <div className="min-w-0 flex-1 pb-[var(--bottom-nav-height)] md:pb-0">
        <Outlet />
      </div>
      <DueAlerts />
      <BottomNav />
    </div>
  );
}
