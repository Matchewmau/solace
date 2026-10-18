import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { Box, Button } from "../components/ui";

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
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12 text-ink">
      <Box className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="label text-xs text-muted">Cafe</p>
          <h1 className="text-3xl font-semibold">Login</h1>
          <p className="text-sm text-muted">
            Staff login to open the register, stock, and guide.
          </p>
        </div>
        <form
          aria-label="Staff login"
          className="flex flex-col gap-3"
          onSubmit={(event) => void submit(event)}
        >
          <input
            aria-label="Username"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
            placeholder="Username"
            className="border border-ink/20 bg-paper px-3 py-2 text-lg text-ink"
          />
          <div className="flex gap-2">
            <input
              aria-label="Password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              placeholder="Password"
              className="min-w-0 flex-1 border border-ink/20 bg-paper px-3 py-2 text-lg text-ink"
            />
            <Button
              ariaLabel={showPassword ? "Hide password" : "Show password"}
              ariaPressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? "Hide" : "Show"}
            </Button>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={pending || username === "" || password === ""}
          >
            {pending ? "Logging in…" : "Log in"}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-accent">
              {error}
            </p>
          ) : null}
        </form>
        <p className="text-sm text-muted">
          Open orders live in this browser — use one address (the LAN IP)
          consistently.
        </p>
      </Box>
    </main>
  );
}
