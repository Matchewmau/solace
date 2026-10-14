import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/**
 * Shared header on every authed page. Logout sits on the right; the left
 * slot beside the title is reserved for the Task 3 back-to-dashboard
 * button — keep this row a left-title / right-logout flex.
 */
export function AppHeader() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function onLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="border-b border-ink/10 bg-paper text-ink">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-3">
        {/* Task 3 slot: back button goes left of the title. */}
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
