import { useState } from "react";
import { BottomSheet } from "./BottomSheet";

/**
 * Cash change calculator shown at the pay moment.
 *
 * Composes {@link BottomSheet} for the entrance, focus trap, Escape, and
 * backdrop-close contract, so this stays on the eager/POS chunk (pure-CSS
 * `.sheet-up`, no animation library). The owner hands over cash, taps a
 * denomination or types an amount, and reads the live change — a big green
 * figure when covered, a red "short" figure when not. Confirm stays disabled
 * until the received amount covers the total, and never submits `0`-short.
 */

/** Peso money with cents, e.g. 14000 -> "₱140.00". Used across the pay UI. */
export function formatMoney(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

/** Quick denomination chips, in cents (₱100/₱200/₱500/₱1000). */
const CHIPS = [10000, 20000, 50000, 100000];

export function PaySheet({
  totalCents,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  totalCents: number;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (receivedCents: number) => void;
}) {
  const [received, setReceived] = useState<number | null>(null);
  const [amount, setAmount] = useState("");

  const change = (received ?? 0) - totalCents;
  const canConfirm = received !== null && received >= totalCents && !pending;

  function pick(cents: number) {
    setReceived(cents);
    setAmount(String(cents / 100));
  }

  function onAmountInput(value: string) {
    setAmount(value);
    const pesos = Number(value);
    setReceived(
      value.trim() !== "" && Number.isFinite(pesos) && pesos >= 0
        ? Math.round(pesos * 100)
        : null,
    );
  }

  return (
    <BottomSheet
      open
      onClose={onCancel}
      title={`Pay ${formatMoney(totalCents)}`}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-0.5">
          <p className="label text-xs text-muted">Total</p>
          <p className="text-2xl font-semibold text-accent">
            {formatMoney(totalCents)}
          </p>
        </div>

        <div role="group" aria-label="Quick amounts" className="flex flex-wrap gap-2">
          {CHIPS.map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => pick(cents)}
              className="press min-h-11 flex-1 border border-ink px-3 text-base font-semibold hover:bg-ink/[0.04]"
            >
              ₱{cents / 100}
            </button>
          ))}
          <button
            type="button"
            onClick={() => pick(totalCents)}
            className="press min-h-11 flex-1 border border-ink px-3 text-base font-semibold hover:bg-ink/[0.04]"
          >
            Exact {formatMoney(totalCents)}
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="label text-xs text-muted">Amount received</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amount}
            onChange={(event) => onAmountInput(event.target.value)}
            className="field rounded-box text-lg"
          />
        </label>

        <div className="flex flex-col gap-0.5">
          <p className="label text-xs text-muted">Change</p>
          <p
            className={`text-4xl font-semibold ${
              change >= 0 ? "text-ok" : "text-danger"
            }`}
          >
            {change >= 0 ? formatMoney(change) : `short ${formatMoney(-change)}`}
          </p>
        </div>

        {error !== "" ? (
          <p role="alert" className="text-base">
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="press min-h-11 flex-1 border border-ink px-4 text-base font-semibold hover:bg-ink/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            aria-busy={pending ? "true" : undefined}
            disabled={!canConfirm}
            onClick={() => onConfirm(received ?? 0)}
            className="press min-h-11 flex-1 bg-ink px-4 text-base font-semibold text-paper hover:bg-ink/90 disabled:opacity-40"
          >
            {pending ? "Saving…" : `Confirm — paid ${formatMoney(totalCents)}`}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
