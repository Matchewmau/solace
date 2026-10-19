/**
 * Same-origin due-alerts API for the global due-soon bar.
 * Relative URLs only — the shared authFetch attaches the login credential
 * and clears the session on a 401 so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export type DueAlertKind = "bill" | "loan" | "payable";

export interface DueAlert {
  key: string;
  kind: DueAlertKind;
  id: number;
  label: string;
  amount_cents: number;
  due_date: string;
  days_until: number;
  overdue: boolean;
  alert_days: number;
}

export interface DueAlertsResponse {
  date: string;
  alerts: DueAlert[];
}

/** Today's UTC date (YYYY-MM-DD), matching the server's alert window. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const KINDS: readonly DueAlertKind[] = ["bill", "loan", "payable"];

/** Drop malformed entries so one bad row cannot crash the app shell. */
function isDueAlert(value: unknown): value is DueAlert {
  if (typeof value !== "object" || value === null) return false;
  const alert = value as Record<string, unknown>;
  return (
    typeof alert.key === "string" &&
    alert.key !== "" &&
    typeof alert.kind === "string" &&
    KINDS.includes(alert.kind as DueAlertKind) &&
    typeof alert.label === "string" &&
    typeof alert.amount_cents === "number" &&
    Number.isFinite(alert.amount_cents) &&
    typeof alert.days_until === "number" &&
    Number.isFinite(alert.days_until) &&
    typeof alert.overdue === "boolean"
  );
}

async function requestJson(url: string): Promise<unknown> {
  const res = await authFetch(url);
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${url}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error !== "") {
        message = body.error;
      }
    } catch {
      // Keep the default status message when the body is not JSON.
    }
    throw new Error(message);
  }
  return (await res.json()) as unknown;
}

export async function fetchDueAlerts(): Promise<DueAlertsResponse> {
  const payload = await requestJson("/api/due-alerts");
  // Existing route tests stub every URL with `[]`; a missing alerts array must
  // read as "nothing due" rather than crash the app shell.
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as { alerts?: unknown }).alerts)
  ) {
    return { date: utcToday(), alerts: [] };
  }
  const response = payload as { date?: unknown; alerts: unknown[] };
  return {
    date: typeof response.date === "string" ? response.date : utcToday(),
    alerts: response.alerts.filter(isDueAlert),
  };
}
