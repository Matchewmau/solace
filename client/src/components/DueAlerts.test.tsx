import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

function stubAlerts(data: DueAlert[] = alerts) {
  return vi.fn(async (url: unknown) => {
    if (String(url) === "/api/due-alerts") {
      return ok({ date: today(), alerts: data });
    }
    throw new Error(`unexpected fetch ${String(url)}`);
  }) as typeof fetch;
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("DueAlerts", () => {
  it("renders due and overdue alerts with ledgers and status text", async () => {
    globalThis.fetch = stubAlerts();
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
    globalThis.fetch = stubAlerts();
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
    globalThis.fetch = stubAlerts();
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
    globalThis.fetch = stubAlerts();
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

  it("starts collapsed on /pos and expands when clicked", async () => {
    globalThis.fetch = stubAlerts();
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

  it("renders nothing when there are no alerts", async () => {
    globalThis.fetch = stubAlerts([]);
    const { client } = renderAlerts();

    await vi.waitFor(() => {
      expect(client.getQueryState(["due-alerts"])?.status).toBe("success");
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Due soon/ })).toBeNull();
  });

  it("renders nothing when the alerts query fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const { client } = renderAlerts();

    await vi.waitFor(() => {
      expect(client.getQueryState(["due-alerts"])?.status).toBe("error");
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: /Due soon/ })).toBeNull();
  });
});
