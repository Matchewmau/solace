import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import DueAlerts from "./DueAlerts";
import type { DueAlert } from "../api/alerts";

const DISMISS_KEY = "solace:due-alerts:dismissed:v1";

const today = () => new Date().toISOString().slice(0, 10);

const alerts: DueAlert[] = [
  {
    key: "bill:1:2026-10-17",
    kind: "bill",
    id: 1,
    label: "Rent",
    amount_cents: 80000,
    due_date: "2026-10-17",
    days_until: -2,
    overdue: true,
    alert_days: 3,
  },
  {
    key: "loan:2:2026-10-19",
    kind: "loan",
    id: 2,
    label: "Bank",
    amount_cents: 50000,
    due_date: "2026-10-19",
    days_until: 0,
    overdue: false,
    alert_days: 3,
  },
  {
    key: "payable:3:2026-10-21",
    kind: "payable",
    id: 3,
    label: "Supplier",
    amount_cents: 12550,
    due_date: "2026-10-21",
    days_until: 2,
    overdue: false,
    alert_days: 3,
  },
];

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function stubPayload(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url) === "/api/due-alerts") return ok(payload);
      throw new Error(`unexpected fetch ${String(url)}`);
    }),
  );
}

function stubAlerts(data: DueAlert[] = alerts): void {
  stubPayload({ date: today(), alerts: data });
}

function renderAlerts(path = "/dashboard") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<DueAlerts />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

/** Router with links, used to prove the open state resets per route. */
function renderAlertsWithNav(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Link to="/pos">POS</Link>
        <Link to="/dashboard">Dashboard</Link>
        <Routes>
          <Route path="*" element={<DueAlerts />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("DueAlerts", () => {
  it("renders due and overdue alerts with ledgers and status text", async () => {
    stubAlerts();
    renderAlerts();

    expect(await screen.findByText("Rent")).toBeDefined();
    expect(screen.getByText("Bank")).toBeDefined();
    expect(screen.getByText("Supplier")).toBeDefined();

    // Kind labels distinguish the three ledgers.
    expect(screen.getByText("Bill")).toBeDefined();
    expect(screen.getByText("Loan")).toBeDefined();
    expect(screen.getByText("Payable")).toBeDefined();

    // Amounts go through formatPeso (whole pesos stay whole).
    expect(screen.getByText("₱800")).toBeDefined();
    expect(screen.getByText("₱500")).toBeDefined();
    expect(screen.getByText("₱125.50")).toBeDefined();

    // Status text, with overdue in the danger tone and due-soon in accent.
    const overdue = screen.getByText("Overdue by 2 days");
    expect(overdue.className).toContain("text-danger");
    const dueToday = screen.getByText("Due today");
    expect(dueToday.className).toContain("text-accent");
    const dueSoon = screen.getByText("Due in 2 days");
    expect(dueSoon.className).toContain("text-accent");

    // Each row links to its ledger.
    expect(
      screen.getByRole("link", { name: "View Rent in bills" }).getAttribute(
        "href",
      ),
    ).toBe("/finance/bills");
    expect(
      screen.getByRole("link", { name: "View Bank in loans" }).getAttribute(
        "href",
      ),
    ).toBe("/finance/loans");
    expect(
      screen.getByRole("link", { name: "View Supplier in payables" }).getAttribute(
        "href",
      ),
    ).toBe("/finance/payables");

    // The expanded container announces politely.
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.parentElement?.className).toBe(
      "fixed right-3 top-3 z-40 w-[min(22rem,calc(100vw-2rem))]",
    );
  });

  it("dismisses one alert for the current UTC day", async () => {
    stubAlerts();
    renderAlerts();
    await screen.findByText("Rent");

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss due alert for Rent" }),
    );

    expect(screen.queryByText("Rent")).toBeNull();
    expect(screen.getByText("Bank")).toBeDefined();
    expect(screen.getByText("Supplier")).toBeDefined();
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null")).toEqual({
      date: today(),
      keys: ["bill:1:2026-10-17"],
    });
  });

  it("dismisses all visible alerts", async () => {
    stubAlerts();
    renderAlerts();
    await screen.findByText("Rent");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Rent")).toBeNull();
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null")).toEqual({
      date: today(),
      keys: alerts.map((alert) => alert.key),
    });
  });

  it("resets dismissals on a new UTC day", async () => {
    localStorage.setItem(
      DISMISS_KEY,
      JSON.stringify({
        date: "2000-01-01",
        keys: alerts.map((alert) => alert.key),
      }),
    );
    stubAlerts();
    renderAlerts();

    expect(await screen.findByText("Rent")).toBeDefined();
    expect(screen.getByText("Bank")).toBeDefined();
    expect(screen.getByText("Supplier")).toBeDefined();

    // A fresh dismissal replaces the stale day's key set.
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss due alert for Rent" }),
    );
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null")).toEqual({
      date: today(),
      keys: ["bill:1:2026-10-17"],
    });
  });

  it("does not carry a prior UTC day's dismissal into today", async () => {
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    stubAlerts();
    renderAlerts();
    await screen.findByText("Rent");

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss due alert for Rent" }),
    );
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null")).toEqual({
      date: "2026-10-19",
      keys: ["bill:1:2026-10-17"],
    });
    expect(screen.queryByText("Rent")).toBeNull();

    // UTC midnight passes while the shell is still mounted.
    vi.setSystemTime(new Date("2026-10-20T00:01:00Z"));

    // Dismissing another alert starts from today's active set, so yesterday's
    // key is neither applied nor re-persisted under today's date.
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss due alert for Bank" }),
    );

    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null")).toEqual({
      date: "2026-10-20",
      keys: ["loan:2:2026-10-19"],
    });
    expect(screen.getByText("Rent")).toBeDefined();
    expect(screen.queryByText("Bank")).toBeNull();
    expect(screen.getByText("Supplier")).toBeDefined();

    // A reload on the new UTC day keeps only the new day's dismissal.
    cleanup();
    stubAlerts();
    renderAlerts();
    expect(await screen.findByText("Rent")).toBeDefined();
    expect(screen.queryByText("Bank")).toBeNull();
    expect(screen.getByText("Supplier")).toBeDefined();
  });

  it("starts collapsed on /pos and expands when clicked", async () => {
    stubAlerts();
    renderAlerts("/pos");

    const pill = await screen.findByRole("button", { name: "Due soon · 3" });
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Rent")).toBeNull();

    fireEvent.click(pill);

    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.getByText("Rent")).toBeDefined();
    expect(screen.getByText("Bank")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Due soon · 3" })).toBeNull();
  });

  it("resets the open state on every route change", async () => {
    stubAlerts();
    renderAlertsWithNav("/pos");

    expect(await screen.findByRole("button", { name: "Due soon · 3" })).toBeDefined();

    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(await screen.findByRole("status")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Due soon · 3" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "POS" }));
    expect(await screen.findByRole("button", { name: "Due soon · 3" })).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders nothing when there are no alerts", async () => {
    stubAlerts([]);
    const { client } = renderAlerts();

    await vi.waitFor(() => {
      expect(client.getQueryState(["due-alerts"])?.status).toBe("success");
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Due soon/ })).toBeNull();
  });

  it("treats a raw array payload as no alerts", async () => {
    stubPayload([]);
    const { client } = renderAlerts();

    await vi.waitFor(() => {
      expect(client.getQueryState(["due-alerts"])?.status).toBe("success");
    });
    expect(client.getQueryData(["due-alerts"])).toEqual({
      date: today(),
      alerts: [],
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Due soon/ })).toBeNull();
  });

  it("ignores malformed alert entries instead of crashing", async () => {
    stubPayload({
      date: today(),
      alerts: [
        null,
        { ...alerts[0], kind: "mystery" },
        { ...alerts[1], key: "" },
        { ...alerts[2], amount_cents: "lots" },
        alerts[0],
      ],
    });
    renderAlerts();

    expect(await screen.findByText("Rent")).toBeDefined();
    expect(screen.queryByText("Bank")).toBeNull();
    expect(screen.queryByText("Supplier")).toBeNull();
    expect(screen.getByText("Bill")).toBeDefined();
  });

  it("shows a new cycle key after a same-day dismissal", async () => {
    stubAlerts();
    const { client } = renderAlerts();
    await screen.findByText("Rent");

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss due alert for Rent" }),
    );
    expect(screen.queryByText("Rent")).toBeNull();

    act(() => {
      client.setQueryData(["due-alerts"], {
        date: today(),
        alerts: [
          {
            ...alerts[0],
            key: "bill:1:2026-11-17",
            due_date: "2026-11-17",
            label: "Rent next cycle",
          },
        ],
      });
    });

    expect(await screen.findByText("Rent next cycle")).toBeDefined();
    expect(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "null")).toEqual({
      date: today(),
      keys: ["bill:1:2026-10-17"],
    });
  });

  it("ignores corrupt or wrong-shape dismissal storage", async () => {
    stubAlerts();
    for (const raw of [
      "{not-json",
      JSON.stringify({ date: today(), keys: "nope" }),
      JSON.stringify(null),
    ]) {
      localStorage.setItem(DISMISS_KEY, raw);
      const view = renderAlerts();
      expect(await screen.findByText("Rent")).toBeDefined();
      view.unmount();
    }
  });

  it("renders nothing when the alerts query fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { client } = renderAlerts();

    await vi.waitFor(() => {
      expect(client.getQueryState(["due-alerts"])?.status).toBe("error");
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Due soon/ })).toBeNull();
  });
});
