import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";

/**
 * Shared staff login (username + password only). Post-login always lands
 * on /dashboard — no deep-link return. Visiting while logged in bounces
 * straight to /dashboard via the guard below.
 */
export default function LoginPage() {
  const { loggedIn, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loggedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await login(username, password);
      if (result.ok) {
        navigate("/dashboard", { replace: true });
      } else {
        setError(result.error ?? "Login failed.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
        <p className="label text-xs text-muted">Cafe &middot; LAN</p>
        <h1 className="text-4xl font-semibold">Login</h1>
        <p className="text-sm text-muted">
          Staff login to open the register, stock, and guide.
        </p>
        <form
          aria-label="Staff login"
          className="flex flex-col gap-3"
          onSubmit={(event) => void submit(event)}
        >
          <input
            aria-label="Username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            placeholder="Username"
            className="border border-ink/20 bg-paper px-3 py-2 text-lg text-ink"
          />
          <input
            aria-label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            placeholder="Password"
            className="border border-ink/20 bg-paper px-3 py-2 text-lg text-ink"
          />
          <button
            type="submit"
            disabled={pending || username === "" || password === ""}
            className="bg-ink px-4 py-2 text-base font-semibold text-paper disabled:opacity-40"
          >
            {pending ? "Logging in…" : "Log in"}
          </button>
          {error ? (
            <p role="alert" className="text-sm text-accent">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
