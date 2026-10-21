import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchDueAlerts,
  type DueAlert,
  type DueAlertKind,
} from "../api/alerts";
import { formatPeso } from "../lib/formatPeso";

/**
 * Global due-soon bar. Mounted once in AuthedLayout, so it must stay free of
 * the motion and three packages (the app shell is on the eager chunk).
 *
 * POS starts collapsed to keep the register clear; every other route starts
 * expanded. Per-alert dismissals live for the current UTC day only, and the
 * server's cycle key (kind:id:due_date) makes the next recurrence re-alert.
 */

const DISMISS_KEY = "solace:due-alerts:dismissed:v1";
const WRAPPER = "fixed right-3 top-3 z-40 w-[min(22rem,calc(100vw-2rem))]";

const KIND_LABEL: Record<DueAlertKind, string> = {
  bill: "Bill",
  loan: "Loan",
  payable: "Payable",
};

const LEDGER: Record<DueAlertKind, { to: string; name: string }> = {
  bill: { to: "/finance/bills", name: "bills" },
  loan: { to: "/finance/loans", name: "loans" },
  payable: { to: "/finance/payables", name: "payables" },
};

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Dismissals {
  date: string;
  keys: string[];
}

/** Stored keys are only valid for the UTC day that dismissed them. */
function readDismissed(): Dismissals {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw === null) return { date: "", keys: [] };
    const parsed = JSON.parse(raw) as { date?: unknown; keys?: unknown };
    if (typeof parsed?.date === "string" && Array.isArray(parsed.keys)) {
      return {
        date: parsed.date,
        keys: parsed.keys.filter(
          (key): key is string => typeof key === "string",
        ),
      };
    }
  } catch {
    // Corrupt or unavailable storage reads as "nothing dismissed".
  }
  return { date: "", keys: [] };
}

function dayCount(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

function statusText(alert: DueAlert): string {
  if (alert.days_until < 0) {
    return `Overdue by ${dayCount(-alert.days_until)}`;
  }
  if (alert.days_until === 0) return "Due today";
  return `Due in ${dayCount(alert.days_until)}`;
}

export default function DueAlerts() {
  const { pathname } = useLocation();
  const onPos = pathname === "/pos";
  const [open, setOpen] = useState(!onPos);
  const [dismissed, setDismissed] = useState<Dismissals>(readDismissed);
  const today = utcToday();
  const activeKeys = dismissed.date === today ? dismissed.keys : [];

  useEffect(() => {
    setOpen(pathname !== "/pos");
  }, [pathname]);

  const alertsQuery = useQuery({
    queryKey: ["due-alerts"],
    queryFn: fetchDueAlerts,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  if (alertsQuery.isError) return null;

  const alerts = alertsQuery.data?.alerts ?? [];
  const visible = alerts.filter((alert) => !activeKeys.includes(alert.key));
  if (visible.length === 0) return null;

  function persist(keys: string[]): void {
    const day = utcToday();
    const base = dismissed.date === day ? dismissed.keys : [];
    const next = [...new Set([...base, ...keys])];
    setDismissed({ date: day, keys: next });
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({ date: day, keys: next }));
    } catch {
      // Storage unavailable (private mode) — the in-memory hide still holds.
    }
  }

  function dismiss(key: string): void {
    persist([key]);
  }

  function dismissAll(): void {
    persist(visible.map((alert) => alert.key));
  }

  if (!open) {
    return (
      <div className={WRAPPER}>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="press flex min-h-11 items-center rounded-full border border-ink/15 bg-paper px-4 text-sm font-semibold text-ink shadow-soft hover:border-ink/30 hover:bg-ink/[0.04]"
        >
          Due soon · {visible.length}
        </button>
      </div>
    );
  }

  return (
    <div className={WRAPPER}>
      <section
        role="status"
        aria-live="polite"
        aria-label="Due soon alerts"
        className="rounded-box border border-ink/10 bg-white p-3 text-ink shadow-soft"
      >
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Due soon</h2>
          <button
            type="button"
            onClick={dismissAll}
            className="press text-xs font-semibold text-accent underline hover:text-ink"
          >
            Dismiss all
          </button>
        </header>
        <ul className="max-h-[70vh] overflow-y-auto divide-y divide-ink/10">
          {visible.map((alert) => {
            const ledger = LEDGER[alert.kind];
            return (
              <li
                key={alert.key}
                className="flex items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {KIND_LABEL[alert.kind]}
                    </span>
                    <Link
                      to={ledger.to}
                      aria-label={`View ${alert.label} in ${ledger.name}`}
                      className="truncate font-semibold underline hover:text-accent"
                    >
                      {alert.label}
                    </Link>
                  </p>
                  <p className="text-sm">{formatPeso(alert.amount_cents)}</p>
                  <p
                    className={`text-xs font-semibold ${
                      alert.overdue ? "text-danger" : "text-accent"
                    }`}
                  >
                    {statusText(alert)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Dismiss due alert for ${alert.label}`}
                  onClick={() => dismiss(alert.key)}
                  className="press min-h-11 min-w-11 shrink-0 rounded-full px-2 text-lg leading-none text-muted hover:bg-ink/[0.04] hover:text-ink"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
