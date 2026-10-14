/**
 * Shared-login session helpers (replaces the old PIN lock).
 * The credential (password) is held in memory and mirrored to localStorage
 * so a reload stays logged in. Every /api call sends it back as the
 * x-solace-auth header via authHeaders() / authFetch().
 * Relative URLs only — no runtime fetches outside /api.
 */

export const AUTH_STORAGE_KEY = "solace-auth";

/** Dispatched on window when any /api call answers 401. */
export const AUTH_UNAUTHORIZED_EVENT = "solace:unauthorized";

let memoryAuth: string | null = null;

export function getStoredAuth(): string | null {
  if (memoryAuth) return memoryAuth;
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      memoryAuth = stored;
      return stored;
    }
  } catch {
    // localStorage unavailable (private mode) — memory only.
  }
  return null;
}

export function setStoredAuth(credential: string): void {
  memoryAuth = credential;
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, credential);
  } catch {
    // Memory still holds the credential for this page lifetime.
  }
}

export function clearStoredAuth(): void {
  memoryAuth = null;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/** Header to attach to every /api call (empty when logged out). */
export function authHeaders(
  credential?: string | null,
): Record<string, string> {
  const value = credential ?? getStoredAuth();
  return value ? { "x-solace-auth": value } : {};
}

export async function loginRequest(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  let body: { ok?: unknown; error?: unknown } = {};
  try {
    body = (await res.json()) as { ok?: unknown; error?: unknown };
  } catch {
    // Non-JSON body — fall through to the status-based result.
  }
  if (res.ok && body.ok === true) return { ok: true };
  return {
    ok: false,
    error:
      typeof body.error === "string" && body.error !== ""
        ? body.error
        : `Login failed: ${res.status}`,
  };
}

function notifyUnauthorized(): void {
  clearStoredAuth();
  try {
    window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
  } catch {
    // No window (non-browser) — storage is still cleared above.
  }
}

/**
 * Same-origin fetch for /api calls: attaches the stored credential and
 * clears the session on 401 so the route guard lands on /login.
 */
export async function authFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (res.status === 401 && url.startsWith("/api/")) {
    notifyUnauthorized();
  }
  return res;
}
