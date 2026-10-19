import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-due-alerts-api-test-"));
const app = createApp(join(dir, "due-alerts-api-test.db"));
const api = authed(app);
const db = app.locals.db;

// Fixed reference day so every window boundary is exact: 2026-10-19.
const DATE = "2026-10-19";

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM bills; DELETE FROM loans; DELETE FROM payables");
});

function addBill({
  name,
  amount_cents = 1000,
  due_date,
  alert_days = 3,
  paid = 0,
}) {
  return db
    .prepare(
      "INSERT INTO bills (name, amount_cents, due_date, due_day, alert_days, paid) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      name,
      amount_cents,
      due_date,
      Number(due_date.slice(8, 10)),
      alert_days,
      paid,
    ).lastInsertRowid;
}

function addLoan({
  lender,
  balance_cents = 100000,
  installment_cents = 10000,
  due_date,
  alert_days = 3,
}) {
  return db
    .prepare(
      "INSERT INTO loans (lender, principal_cents, balance_cents, installment_cents, due_date, due_day, alert_days) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      lender,
      balance_cents,
      balance_cents,
      installment_cents,
      due_date,
      Number(due_date.slice(8, 10)),
      alert_days,
    ).lastInsertRowid;
}

function addPayable({ label, amount_cents = 1000, due_date, paid = 0 }) {
  return db
    .prepare(
      "INSERT INTO payables (label, amount_cents, due_date, paid) VALUES (?, ?, ?, ?)",
    )
    .run(label, amount_cents, due_date, paid).lastInsertRowid;
}

async function getAlerts(date = DATE) {
  return (await api.get(`/api/due-alerts?date=${date}`).expect(200)).body;
}

describe("due alerts", () => {
  it("returns bills inside their alert window and every overdue bill", async () => {
    const overdue = addBill({
      name: "Old Water",
      amount_cents: 7000,
      due_date: "2026-10-01",
      alert_days: 1,
    });
    const inside = addBill({
      name: "Meralco",
      amount_cents: 250000,
      due_date: "2026-10-21",
      alert_days: 3,
    });
    const boundary = addBill({
      name: "Boundary Bill",
      amount_cents: 5000,
      due_date: "2026-10-22",
      alert_days: 3,
    });

    const body = await getAlerts();

    expect(body).toEqual({
      date: DATE,
      alerts: [
        {
          key: `bill:${overdue}:2026-10-01`,
          kind: "bill",
          id: overdue,
          label: "Old Water",
          amount_cents: 7000,
          due_date: "2026-10-01",
          days_until: -18,
          overdue: true,
          alert_days: 1,
        },
        {
          key: `bill:${inside}:2026-10-21`,
          kind: "bill",
          id: inside,
          label: "Meralco",
          amount_cents: 250000,
          due_date: "2026-10-21",
          days_until: 2,
          overdue: false,
          alert_days: 3,
        },
        {
          key: `bill:${boundary}:2026-10-22`,
          kind: "bill",
          id: boundary,
          label: "Boundary Bill",
          amount_cents: 5000,
          due_date: "2026-10-22",
          days_until: 3,
          overdue: false,
          alert_days: 3,
        },
      ],
    });
  });

  it("excludes paid bills and bills outside the window", async () => {
    addBill({ name: "Paid Bill", due_date: "2026-10-19", paid: 1 });
    addBill({
      name: "Paid Overdue",
      due_date: "2026-10-01",
      alert_days: 1,
      paid: 1,
    });
    addBill({ name: "Too Far", due_date: "2026-10-23", alert_days: 3 });
    const included = addBill({
      name: "Included Bill",
      amount_cents: 1234,
      due_date: "2026-10-20",
      alert_days: 3,
    });

    const body = await getAlerts();

    expect(body.alerts.map((alert) => alert.id)).toEqual([included]);
  });

  it("returns loans inside their alert window and every overdue loan", async () => {
    const overdue = addLoan({
      lender: "Old Loan",
      balance_cents: 40000,
      installment_cents: 4000,
      due_date: "2026-09-30",
      alert_days: 1,
    });
    const inside = addLoan({
      lender: "BDO",
      balance_cents: 90000,
      installment_cents: 10000,
      due_date: "2026-10-21",
      alert_days: 3,
    });
    const boundary = addLoan({
      lender: "Boundary Loan",
      balance_cents: 50000,
      installment_cents: 5000,
      due_date: "2026-10-22",
      alert_days: 3,
    });

    const body = await getAlerts();

    expect(body).toEqual({
      date: DATE,
      alerts: [
        {
          key: `loan:${overdue}:2026-09-30`,
          kind: "loan",
          id: overdue,
          label: "Old Loan",
          amount_cents: 4000,
          due_date: "2026-09-30",
          days_until: -19,
          overdue: true,
          alert_days: 1,
        },
        {
          key: `loan:${inside}:2026-10-21`,
          kind: "loan",
          id: inside,
          label: "BDO",
          amount_cents: 10000,
          due_date: "2026-10-21",
          days_until: 2,
          overdue: false,
          alert_days: 3,
        },
        {
          key: `loan:${boundary}:2026-10-22`,
          kind: "loan",
          id: boundary,
          label: "Boundary Loan",
          amount_cents: 5000,
          due_date: "2026-10-22",
          days_until: 3,
          overdue: false,
          alert_days: 3,
        },
      ],
    });
  });

  it("excludes a zero-balance loan", async () => {
    addLoan({
      lender: "Settled Loan",
      balance_cents: 0,
      installment_cents: 5000,
      due_date: "2026-10-19",
    });
    const outstanding = addLoan({
      lender: "Outstanding Loan",
      balance_cents: 20000,
      installment_cents: 2000,
      due_date: "2026-10-19",
    });

    const body = await getAlerts();

    expect(body.alerts.map((alert) => alert.id)).toEqual([outstanding]);
  });

  it("returns unpaid payables inside 3 days and every overdue payable", async () => {
    const overdue = addPayable({
      label: "Overdue Payable",
      amount_cents: 40000,
      due_date: "2026-10-05",
    });
    addPayable({
      label: "Too Far Payable",
      amount_cents: 30000,
      due_date: "2026-10-23",
    });
    addPayable({
      label: "Paid Payable",
      amount_cents: 99999,
      due_date: "2026-10-19",
      paid: 1,
    });
    const boundary = addPayable({
      label: "Boundary Payable",
      amount_cents: 20000,
      due_date: "2026-10-22",
    });

    const body = await getAlerts();

    expect(body).toEqual({
      date: DATE,
      alerts: [
        {
          key: `payable:${overdue}:2026-10-05`,
          kind: "payable",
          id: overdue,
          label: "Overdue Payable",
          amount_cents: 40000,
          due_date: "2026-10-05",
          days_until: -14,
          overdue: true,
          alert_days: 3,
        },
        {
          key: `payable:${boundary}:2026-10-22`,
          kind: "payable",
          id: boundary,
          label: "Boundary Payable",
          amount_cents: 20000,
          due_date: "2026-10-22",
          days_until: 3,
          overdue: false,
          alert_days: 3,
        },
      ],
    });
  });

  it("sorts by due date then label", async () => {
    addPayable({ label: "Zeta Payable", due_date: "2026-10-20" });
    addBill({ name: "Alpha Bill", due_date: "2026-10-20" });
    addBill({ name: "Beta Bill", due_date: "2026-10-21" });
    addLoan({
      lender: "Overdue Loan",
      due_date: "2026-10-01",
      alert_days: 1,
    });
    addPayable({ label: "Alpha Payable", due_date: "2026-10-20" });

    const body = await getAlerts();

    expect(body.alerts.map((alert) => alert.label)).toEqual([
      "Overdue Loan",
      "Alpha Bill",
      "Alpha Payable",
      "Zeta Payable",
      "Beta Bill",
    ]);
    expect(body.alerts.map((alert) => alert.due_date)).toEqual([
      "2026-10-01",
      "2026-10-20",
      "2026-10-20",
      "2026-10-20",
      "2026-10-21",
    ]);
  });

  it("uses kind:id:due_date keys", async () => {
    const bill = addBill({ name: "Key Bill", due_date: "2026-10-19" });
    const loan = addLoan({ lender: "Key Loan", due_date: "2026-10-19" });
    const payable = addPayable({
      label: "Key Payable",
      due_date: "2026-10-19",
    });

    const body = await getAlerts();

    expect(body.alerts.map((alert) => alert.key)).toEqual([
      `bill:${bill}:2026-10-19`,
      `loan:${loan}:2026-10-19`,
      `payable:${payable}:2026-10-19`,
    ]);
    expect(body.alerts.map((alert) => alert.kind)).toEqual([
      "bill",
      "loan",
      "payable",
    ]);
  });

  it("validates the date query", async () => {
    for (const date of ["2026-02-30", "not-a-date", "2026-1-1"]) {
      const res = await api
        .get(`/api/due-alerts?date=${encodeURIComponent(date)}`)
        .expect(400);
      expect(res.body).toEqual({ error: "date must be YYYY-MM-DD" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const body = (await api.get("/api/due-alerts").expect(200)).body;
    expect(body).toEqual({ date: today, alerts: [] });
  });
});
