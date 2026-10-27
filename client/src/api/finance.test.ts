import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearStoredAuth, setStoredAuth } from "../lib/auth";
import { deleteBill, patchBill, patchLoan } from "./finance";

type Captured = { url: string; method: string; body: string | null };
let requests: Captured[] = [];
let failDelete = false;

function installFetch() {
  requests = [];
  failDelete = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body === undefined ? null : String(init.body),
      });
      if (failDelete) {
        return { ok: false, status: 400, json: async () => ({ error: "loan has payment history" }) } as Response;
      }
      return { ok: true, status: 204, json: async () => ({}) } as Response;
    }),
  );
}

beforeEach(() => {
  setStoredAuth("solace123");
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

describe("finance edit/delete helpers", () => {
  it("PATCHes a cleared bill end date as null", async () => {
    await patchBill(7, { name: "Meralco", end_date: null });
    expect(requests[0]).toEqual({
      url: "/api/bills/7",
      method: "PATCH",
      body: '{"name":"Meralco","end_date":null}',
    });
  });

  it("PATCHes the loan current balance", async () => {
    await patchLoan(4, { balance_cents: 25000 });
    expect(requests[0]).toEqual({
      url: "/api/loans/4",
      method: "PATCH",
      body: '{"balance_cents":25000}',
    });
  });

  it("DELETEs and resolves on 204", async () => {
    await deleteBill(9);
    expect(requests[0]).toEqual({ url: "/api/bills/9", method: "DELETE", body: null });
  });

  it("surfaces the server message on a rejected DELETE", async () => {
    failDelete = true;
    await expect(deleteBill(9)).rejects.toThrow("loan has payment history");
  });
});
