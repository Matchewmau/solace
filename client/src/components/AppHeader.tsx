import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

const tabs = [
  { name: "Dashboard", to: "/dashboard" },
  { name: "POS", to: "/pos" },
  { name: "Guide", to: "/guide" },
  { name: "Menu", to: "/menu" },
  { name: "Finance", to: "/finance" },
  { name: "Today", to: "/today" },
  { name: "History", to: "/history" },
] as const;

function isTabActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  return to === "/finance" && pathname.startsWith("/finance/history");
}

/**
 * Global side rail on every authed page. Tabs match the POS rail visual
 * (ink bg, paper text, coffee fill on the current tab). Logout is pinned
 * at the bottom via mt-auto and really logs out. Motion/three-free.
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
      className="flex w-24 shrink-0 flex-col items-center gap-3 bg-ink py-6 text-paper"
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

export function AuthedLayout() {
  return (
    <div className="flex min-h-screen bg-paper text-ink">
      <SideNav />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
