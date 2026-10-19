import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-loans-recurring-test-"));
const app = createApp(join(dir, "loans-recurring-test.db"));
const api = authed(app);

const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function createLoan(overrides = {}) {
  return (
    await api
      .post("/api/loans")
      .send({
        lender: "Loan",
        principal_cents: 100000,
        installment_cents: 10000,
        due_date: "2026-11-05",
        ...overrides,
      })
      .expect(201)
  ).body;
}

async function pay(loanId, amount_cents) {
  return (
    await api
      .post(`/api/loans/${loanId}/payments`)
      .send({ amount_cents })
      .expect(201)
  ).body;
}

describe("recurring loans", () => {
  it("creates a loan with due date, frequency, end date, and alert days", async () => {
    const created = await createLoan({
      lender: "Recurring Lender",
      principal_cents: 120000,
      installment_cents: 12000,
      due_date: "2026-11-05",
      frequency: "weekly",
      end_date: "2027-01-31",
      alert_days: 7,
    });
    expect(created).toMatchObject({
      lender: "Recurring Lender",
      principal_cents: 120000,
      balance_cents: 120000,
      installment_cents: 12000,
      due_date: "2026-11-05",
      due_day: 5,
      frequency: "weekly",
      end_date: "2027-01-31",
      alert_days: 7,
    });
    expect(created.id).toEqual(expect.any(Number));
  });

  it("a payment advances a monthly due date", async () => {
    const loan = await createLoan({
      lender: "Monthly Lender",
      due_date: "2026-11-05",
      frequency: "monthly",
    });
    const result = await pay(loan.id, 10000);
    expect(result).toMatchObject({
      balance_cents: 90000,
      due_date: "2026-12-05",
    });
    expect(result.payment).toMatchObject({
      loan_id: loan.id,
      amount_cents: 10000,
    });
    expect(result.payment.paid_at).toMatch(STAMP_RE);

    const fetched = await api.get(`/api/loans/${loan.id}`).expect(200);
    expect(fetched.body).toMatchObject({
      due_date: "2026-12-05",
      due_day: 5,
    });
  });

  it("a payment advances a weekly due date", async () => {
    const loan = await createLoan({
      lender: "Weekly Lender",
      due_date: "2026-11-05",
      frequency: "weekly",
    });
    const result = await pay(loan.id, 10000);
    expect(result).toMatchObject({
      balance_cents: 90000,
      due_date: "2026-11-12",
    });
    const fetched = await api.get(`/api/loans/${loan.id}`).expect(200);
    expect(fetched.body).toMatchObject({
      due_date: "2026-11-12",
      due_day: 12,
    });
  });

  it("a payment does not advance past the inclusive end date", async () => {
    const inclusive = await createLoan({
      lender: "Inclusive End",
      due_date: "2026-11-05",
      end_date: "2026-12-05",
    });
    const atEnd = await pay(inclusive.id, 1000);
    expect(atEnd.due_date).toBe("2026-12-05");

    const past = await createLoan({
      lender: "Past End",
      due_date: "2026-11-05",
      end_date: "2026-12-04",
    });
    const stopped = await pay(past.id, 1000);
    expect(stopped.due_date).toBe("2026-11-05");

    const fetched = await api.get(`/api/loans/${past.id}`).expect(200);
    expect(fetched.body).toMatchObject({
      due_date: "2026-11-05",
      due_day: 5,
    });
  });

  it("a payment that zeroes the balance leaves the due date alone", async () => {
    const loan = await createLoan({
      lender: "Payoff Lender",
      principal_cents: 10000,
      balance_cents: 10000,
      installment_cents: 5000,
      due_date: "2026-11-05",
    });
    const result = await pay(loan.id, 10000);
    expect(result).toMatchObject({
      balance_cents: 0,
      due_date: "2026-11-05",
    });
    const fetched = await api.get(`/api/loans/${loan.id}`).expect(200);
    expect(fetched.body).toMatchObject({
      balance_cents: 0,
      due_date: "2026-11-05",
      due_day: 5,
    });
  });

  it("rejects a bad due date, frequency, alert days, or end date before due date", async () => {
    const bad = [
      { due_date: "2026-02-30" },
      { due_date: undefined },
      { frequency: "daily" },
      { frequency: "yearly" },
      { alert_days: 0 },
      { alert_days: 31 },
      { alert_days: "3" },
      { end_date: "2026-10-31" },
      { end_date: "not-a-date" },
    ];
    for (const overrides of bad) {
      const res = await api
        .post("/api/loans")
        .send({
          lender: "Bad Loan",
          principal_cents: 100,
          installment_cents: 10,
          due_date: "2026-11-01",
          ...overrides,
        })
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }

    const created = await createLoan({ lender: "Patch Bad" });
    const badPatches = [
      { frequency: "daily" },
      { alert_days: 0 },
      { due_date: "nope" },
      { end_date: "2026-10-31" },
      { due_day: 99 },
    ];
    for (const overrides of badPatches) {
      const res = await api
        .patch(`/api/loans/${created.id}`)
        .send(overrides)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("an old DB with due_day NOT NULL accepts a new loan after migration", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "solace-loans-legacy-"));
    const legacyPath = join(legacyDir, "legacy.db");
    try {
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE loans (id INTEGER PRIMARY KEY, lender TEXT NOT NULL, principal_cents INTEGER NOT NULL, balance_cents INTEGER NOT NULL, installment_cents INTEGER NOT NULL, due_day INTEGER NOT NULL)",
      );
      legacy
        .prepare(
          "INSERT INTO loans (lender, principal_cents, balance_cents, installment_cents, due_day) VALUES (?, ?, ?, ?, ?)",
        )
        .run("Legacy Lender", 50000, 40000, 5000, 15);
      legacy.close();

      const legacyApp = createApp(legacyPath);
      try {
        const legacyApi = authed(legacyApp);
        const res = await legacyApi
          .post("/api/loans")
          .send({
            lender: "Migrated Loan",
            principal_cents: 30000,
            installment_cents: 3000,
            due_date: "2026-11-20",
          })
          .expect(201);
        expect(res.body).toMatchObject({
          lender: "Migrated Loan",
          due_date: "2026-11-20",
          due_day: 20,
          frequency: "monthly",
          end_date: null,
          alert_days: 3,
        });

        const legacyRow = await legacyApi.get("/api/loans/1").expect(200);
        expect(legacyRow.body.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(legacyRow.body).toMatchObject({
          due_day: 15,
          frequency: "monthly",
          end_date: null,
          alert_days: 3,
        });

        const index = legacyApp.locals.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_loans_due_date'",
          )
          .get();
        expect(index).toBeDefined();
      } finally {
        legacyApp.locals.db.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("payment history still returns the recorded payments", async () => {
    const loan = await createLoan({ lender: "History Lender" });
    const first = (await pay(loan.id, 1000)).payment;
    const second = (await pay(loan.id, 2000)).payment;
    const history = await api
      .get(`/api/loans/${loan.id}/payments`)
      .expect(200);
    expect(history.body.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(history.body.map((row) => row.amount_cents)).toEqual([2000, 1000]);
    for (const row of history.body) {
      expect(row.loan_id).toBe(loan.id);
      expect(row.paid_at).toMatch(STAMP_RE);
    }
  });
});
