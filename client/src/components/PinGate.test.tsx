import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FinancePage from "../pages/FinancePage";
import {
  clearStoredPin,
  getStoredPin,
  pinHeaders,
  setStoredPin,
} from "../lib/pin";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredPin();
  sessionStorage.clear();
});

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

// PIN-set server: verify 401s unless the body PIN matches; data endpoints open.
function stubLockedServer(seen: Array<{ url: string; headers: unknown }>) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/auth/verify" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { pin?: string };
      if (body.pin === "1234") return ok({ ok: true });
      return ok({ ok: false, error: "incorrect pin" }, 401);
    }
    if (u === "/api/bills") {
      return ok([
        { id: 1, name: "Meralco", amount_cents: 250000, due_day: 15, paid: 0 },
      ]);
    }
    if (u === "/api/expenses" || u === "/api/payables" || u === "/api/loans") {
      return ok([]);
    }
    const billMatch = u.match(/^\/api\/bills\/(\d+)$/);
    if (billMatch && init?.method === "PATCH") {
      seen.push({ url: u, headers: init.headers });
      const body = JSON.parse(String(init.body)) as { paid: 0 | 1 };
      return ok({ id: 1, name: "Meralco", amount_cents: 250000, due_day: 15, ...body });
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

function renderFinance() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FinancePage />
    </QueryClientProvider>,
  );
}

describe("pin lib (Task 15)", () => {
  it("attaches no header when unlocked-off, x-solace-pin once stored", () => {
    expect(getStoredPin()).toBeNull();
    expect(pinHeaders()).toEqual({});
    setStoredPin("1234");
    expect(getStoredPin()).toBe("1234");
    expect(pinHeaders()).toEqual({ "x-solace-pin": "1234" });
  });
});

describe("FinancePage PIN lock (Task 15, mocked)", () => {
  it("blocks finance content until verify, then attaches the PIN to mutations", async () => {
    const seen: Array<{ url: string; headers: unknown }> = [];
    stubLockedServer(seen);
    renderFinance();

    // Locked: lock screen shows, finance content stays hidden.
    await screen.findByText(/manager PIN to unlock finance/);
    expect(screen.queryByText("Meralco")).toBeNull();

    // Unlock with the manager PIN.
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText("Meralco");

    // Mutations carry the stored PIN header.
    fireEvent.click(screen.getByLabelText("Toggle paid for Meralco"));
    await vi.waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0].url).toBe("/api/bills/1");
    expect(seen[0].headers).toMatchObject({ "x-solace-pin": "1234" });
  });

  it("wrong PIN keeps the lock screen up", async () => {
    const seen: Array<{ url: string; headers: unknown }> = [];
    stubLockedServer(seen);
    renderFinance();
    await screen.findByText(/manager PIN to unlock finance/);

    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "0000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await screen.findByText("Incorrect PIN.");
    expect(screen.queryByText("Meralco")).toBeNull();
  });

  it("stays open with no lock screen when the server has no PIN set", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/auth/verify") return ok({ ok: true });
      if (u === "/api/bills") {
        return ok([
          { id: 1, name: "Meralco", amount_cents: 250000, due_day: 15, paid: 0 },
        ]);
      }
      if (u === "/api/expenses" || u === "/api/payables" || u === "/api/loans") {
        return ok([]);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;
    renderFinance();
    await screen.findByText("Meralco");
    expect(screen.queryByText(/manager PIN/)).toBeNull();
  });
});
