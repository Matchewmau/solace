import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/**
 * Shared header on every authed page. Logout sits on the right; the back
 * button sits left of the title on every subpage (dashboard owns the nav
 * and has none). Keep this row a left-title / right-logout flex,
 * motion-free and brand-token styled.
 */
export function BackToDashboard() {
  return (
    <Link
      to="/dashboard"
      aria-label="Back to dashboard"
      className="border border-ink px-3 py-1 text-sm font-semibold"
    >
      ← Back
    </Link>
  );
}

export function AppHeader() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showBack = pathname !== "/dashboard";

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="border-b border-ink/10 bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
        {showBack ? <BackToDashboard /> : null}
        <p className="label text-xs text-muted">Solace &middot; Staff</p>
        <button
          type="button"
          onClick={onLogout}
          className="ml-auto border border-ink px-3 py-1 text-sm font-semibold"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

export function AuthedLayout() {
  return (
    <>
      <AppHeader />
      <Outlet />
    </>
  );
}
