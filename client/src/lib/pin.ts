/**
 * PIN lock helpers (Task 15): the verified PIN is held in memory and
 * mirrored to sessionStorage so a tab reload keeps the unlocked pages
 * without re-prompting. Cleared when the tab session ends.
 * Relative URLs only — verify goes to same-origin /api/auth/verify.
 */

export const PIN_STORAGE_KEY = "solace-pin";

let memoryPin: string | null = null;

export function getStoredPin(): string | null {
  if (memoryPin) return memoryPin;
  try {
    const stored = sessionStorage.getItem(PIN_STORAGE_KEY);
    if (stored) {
      memoryPin = stored;
      return stored;
    }
  } catch {
    // sessionStorage unavailable (private mode) — memory only.
  }
  return null;
}

export function setStoredPin(pin: string): void {
  memoryPin = pin;
  try {
    sessionStorage.setItem(PIN_STORAGE_KEY, pin);
  } catch {
    // Memory still holds the PIN for this page lifetime.
  }
}

export function clearStoredPin(): void {
  memoryPin = null;
  try {
    sessionStorage.removeItem(PIN_STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/** Header to attach to every mutating /api call (empty when unlocked-off). */
export function pinHeaders(pin?: string | null): Record<string, string> {
  const value = pin ?? getStoredPin();
  return value ? { "x-solace-pin": value } : {};
}

export async function verifyPin(
  pin: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
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
    error: typeof body.error === "string" && body.error !== "" ? body.error : `Verify failed: ${res.status}`,
  };
}
