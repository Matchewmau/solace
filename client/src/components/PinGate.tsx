import { useEffect, useState } from "react";
import { getStoredPin, setStoredPin, verifyPin } from "../lib/pin";

export type PinGateState = "checking" | "open" | "locked";

/**
 * PIN gate for the /finance and /inventory lock screens (Task 15).
 * Probes POST /api/auth/verify with an empty PIN: when SOLACE_PIN is unset
 * the server answers ok:true and the page stays open (no lock, no 401s);
 * when a PIN is set the probe 401s and the lock screen takes over. A stored
 * PIN is re-verified so a changed server PIN re-locks. Probe network
 * failures default to open so the page's normal error state shows.
 */
export function usePinGate() {
  const [state, setState] = useState<PinGateState>("checking");
  useEffect(() => {
    let live = true;
    (async () => {
      const stored = getStoredPin();
      try {
        const result = await verifyPin(stored ?? "");
        if (live) setState(result.ok ? "open" : "locked");
      } catch {
        if (live) setState("open");
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return { state, unlock: () => setState("open") };
}

export function PinPrompt({
  onUnlock,
  submitLabel = "Unlock",
}: {
  onUnlock: () => void | Promise<void>;
  submitLabel?: string;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (input === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await verifyPin(input);
      if (result.ok) {
        setStoredPin(input);
        await onUnlock();
      } else {
        setError("Incorrect PIN.");
      }
    } catch {
      setError("Could not verify PIN.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="PIN unlock" className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <input
        aria-label="PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={input}
        onChange={(event) => setInput(event.currentTarget.value)}
        placeholder="PIN"
        className="border border-ink/20 bg-paper px-3 py-2 text-lg text-ink"
      />
      <button
        type="submit"
        disabled={pending || input === ""}
        className="bg-ink px-4 py-2 text-base font-semibold text-paper disabled:opacity-40"
      >
        {pending ? "Verifying…" : submitLabel}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Full lock screen blocking finance/inventory content until verified. */
export function PinLockScreen({
  page,
  onUnlock,
}: {
  page: string;
  onUnlock: () => void;
}) {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
        <p className="label text-xs text-muted">Cafe &middot; LAN</p>
        <h1 className="text-4xl font-semibold">{page}</h1>
        <p className="text-sm text-muted">
          Enter the manager PIN to unlock {page.toLowerCase()}.
        </p>
        <PinPrompt onUnlock={onUnlock} />
      </div>
    </main>
  );
}
