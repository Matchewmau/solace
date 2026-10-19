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
 * motion/react and three (the app shell is on the eager chunk).
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

/** Stored keys are only valid for the UTC day that dismissed them. */
function readDismissed(today: string): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as { date?: unknown; keys?: unknown };
    if (parsed?.date === today && Array.isArray(parsed.keys)) {
      return parsed.keys.filter((key): key is string => typeof key === "string");
    }
  } catch {
    // Corrupt or unavailable storage reads as "nothing dismissed".
  }
  return [];
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
  const [dismissed, setDismissed] = useState<string[]>(() =>
    readDismissed(utcToday()),
  );

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
  const visible = alerts.filter((alert) => !dismissed.includes(alert.key));
  if (visible.length === 0) return null;

  function persist(keys: string[]): void {
    const next = [...new Set(keys)];
    setDismissed(next);
    try {
      localStorage.setItem(
        DISMISS_KEY,
        JSON.stringify({ date: utcToday(), keys: next }),
      );
    } catch {
      // Storage unavailable (private mode) — the in-memory hide still holds.
    }
  }

  function dismiss(key: string): void {
    persist([...dismissed, key]);
  }

  function dismissAll(): void {
    persist([...dismissed, ...visible.map((alert) => alert.key)]);
  }

  if (!open) {
    return (
      <div className={WRAPPER}>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="press flex min-h-11 items-center rounded-full border border-ink/15 bg-paper px-4 text-sm font-semibold text-ink shadow-soft"
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
            className="press text-xs font-semibold text-accent underline"
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
                      className="truncate font-semibold underline"
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
                  className="press shrink-0 rounded-full px-2 text-lg leading-none text-muted hover:text-ink"
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
