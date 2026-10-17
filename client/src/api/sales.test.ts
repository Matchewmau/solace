import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import { patchSalePaid, type Sale } from "./sales";

function saleResponse(): Sale {
  return {
    id: 7,
    daily_seq: 3,
    total_cents: 7000,
    payment: "cash",
    voided: 0,
    paid: 1,
    created_at: "2026-10-13 10:00:00",
    received_cents: 7500,
    change_cents: 500,
    items: [],
  };
}

type Captured = { url: string; init?: RequestInit };

let requests: Captured[] = [];

function installFetch(): void {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => saleResponse(),
      } as Response;
    }),
  );
}

function lastBody(): string {
  const last = requests.at(-1);
  if (!last) throw new Error("no request captured");
  return String(last.init?.body);
}

describe("patchSalePaid", () => {
  beforeEach(() => {
    setStoredAuth("solace123");
    installFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearStoredAuth();
    localStorage.clear();
  });

  it("sends received_cents when a received amount is provided", async () => {
    await patchSalePaid(7, 1, 7500);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/sales/7");
    expect(requests[0].init?.method).toBe("PATCH");
    expect(lastBody()).toBe('{"paid":1,"received_cents":7500}');
  });

  it("omits received_cents when no received amount is provided", async () => {
    await patchSalePaid(7, 1);
    expect(requests).toHaveLength(1);
    expect(lastBody()).toBe('{"paid":1}');
  });

  it("sends a provided received_cents of 0 (not treated as omitted)", async () => {
    await patchSalePaid(7, 1, 0);
    expect(lastBody()).toBe('{"paid":1,"received_cents":0}');
  });
});
