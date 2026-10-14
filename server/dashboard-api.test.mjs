import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-dashboard-api-test-"));
const app = createApp(join(dir, "dashboard-api-test.db"));
const api = authed(app);
const db = app.locals.db;

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

// Fixed dashboard window: date = day under test, month = its month.
// Cutoff for the dues window is date + 7 days = 2026-10-20 (UTC).
const DATE = "2026-10-13";
const MONTH = "2026-10";

const seed = db.transaction(() => {
  const catId = db
    .prepare("INSERT INTO categories (name, sort) VALUES ('Dashboard Coffee', 1)")
    .run().lastInsertRowid;
  const addItem = db.prepare(
    "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active) VALUES (?, ?, ?, 0, 1)",
  );
  // Six items: top-5 cap test needs six sellers with distinct qty totals.
  const i1 = addItem.run(catId, "Item One", 1000).lastInsertRowid;
  const i2 = addItem.run(catId, "Item Two", 2000).lastInsertRowid;
  const i3 = addItem.run(catId, "Item Three", 100).lastInsertRowid;
  const i4 = addItem.run(catId, "Item Four", 500).lastInsertRowid;
  const i5 = addItem.run(catId, "Item Five", 300).lastInsertRowid;
  const i6 = addItem.run(catId, "Item Six", 100).lastInsertRowid;

  const addSale = db.prepare(
    "INSERT INTO sales (total_cents, payment, voided, created_at) VALUES (?, ?, ?, ?)",
  );
  const addLine = db.prepare(
    "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents) VALUES (?, ?, ?, ?)",
  );
  // s1: in-day cash. s2: in-day gcash. s3: VOIDED in-day (excluded
  // everywhere). s4: in-month only. s5: September (outside month).
  const s1 = addSale.run(10000, "cash", 0, "2026-10-13 08:00:00").lastInsertRowid;
  addLine.run(s1, i1, 4, 1000);
  addLine.run(s1, i2, 3, 2000);
  const s2 = addSale.run(3800, "gcash", 0, "2026-10-13 09:00:00").lastInsertRowid;
  addLine.run(s2, i1, 2, 1000);
  addLine.run(s2, i3, 8, 100);
  addLine.run(s2, i4, 2, 500);
  const s3 = addSale.run(10000, "cash", 1, "2026-10-13 10:00:00").lastInsertRowid;
  addLine.run(s3, i6, 100, 100);
  const s4 = addSale.run(16500, "cash", 0, "2026-10-05 08:00:00").lastInsertRowid;
  addLine.run(s4, i1, 4, 1000);
  addLine.run(s4, i2, 5, 2000);
  addLine.run(s4, i4, 3, 500);
  addLine.run(s4, i5, 3, 300);
  addLine.run(s4, i6, 1, 100);
  const s5 = addSale.run(100000, "cash", 0, "2026-09-30 08:00:00").lastInsertRowid;
  addLine.run(s5, i1, 100, 1000);

  const addExpense = db.prepare(
    "INSERT INTO expenses (date, category, amount_cents, note) VALUES (?, ?, ?, '')",
  );
  addExpense.run("2026-10-13", "Beans", 4000);
  addExpense.run("2026-10-05", "Milk", 1000);
  addExpense.run("2026-09-01", "Old", 99999);

  const addBill = db.prepare(
    "INSERT INTO bills (name, amount_cents, due_day, paid) VALUES (?, ?, ?, ?)",
  );
  addBill.run("Meralco", 250000, 5, 0);
  addBill.run("Water", 50000, 20, 0);
  addBill.run("Paid Bill", 99999, 1, 1);

  const addPayable = db.prepare(
    "INSERT INTO payables (label, amount_cents, due_date, paid) VALUES (?, ?, ?, ?)",
  );
  addPayable.run("Today Due", 10000, "2026-10-13", 0);
  addPayable.run("Week Due", 20000, "2026-10-20", 0);
  addPayable.run("Later Due", 30000, "2026-10-21", 0);
  addPayable.run("Overdue", 40000, "2026-10-01", 0);
  addPayable.run("Paid Due", 99999, "2026-10-14", 1);

  const addLoan = db.prepare(
    "INSERT INTO loans (lender, principal_cents, balance_cents, installment_cents, due_day) VALUES (?, ?, ?, ?, ?)",
  );
  addLoan.run("BDO", 100000, 90000, 10000, 15);
  addLoan.run("Settled Lender", 50000, 0, 5000, 5);

  return { i1, i2, i3, i4, i5, i6 };
});
const ids = seed();

function scalar(sql, ...params) {
  return db.prepare(sql).get(...params);
}

describe("dashboard reconciliation (Task 13)", () => {
  it("GET /api/dashboard returns the verbatim shape with API == raw SQL on every line", async () => {
    const res = await api
      .get(`/api/dashboard?date=${DATE}&month=${MONTH}`)
      .expect(200);
    const body = res.body;
    expect(body.date).toBe(DATE);
    expect(body.month).toBe(MONTH);

    // Hand-written SQL over raw tables — independent of the endpoint code.
    const dayCash = scalar(
      "SELECT COALESCE(SUM(total_cents), 0) AS v FROM sales WHERE created_at LIKE ? AND voided = 0 AND payment = 'cash'",
      `${DATE}%`,
    ).v;
    const dayGcash = scalar(
      "SELECT COALESCE(SUM(total_cents), 0) AS v FROM sales WHERE created_at LIKE ? AND voided = 0 AND payment = 'gcash'",
      `${DATE}%`,
    ).v;
    const dayCount = scalar(
      "SELECT COUNT(*) AS v FROM sales WHERE created_at LIKE ? AND voided = 0",
      `${DATE}%`,
    ).v;
    const monthCash = scalar(
      "SELECT COALESCE(SUM(total_cents), 0) AS v FROM sales WHERE created_at LIKE ? AND voided = 0 AND payment = 'cash'",
      `${MONTH}%`,
    ).v;
    const monthGcash = scalar(
      "SELECT COALESCE(SUM(total_cents), 0) AS v FROM sales WHERE created_at LIKE ? AND voided = 0 AND payment = 'gcash'",
      `${MONTH}%`,
    ).v;
    const monthCount = scalar(
      "SELECT COUNT(*) AS v FROM sales WHERE created_at LIKE ? AND voided = 0",
      `${MONTH}%`,
    ).v;
    const expDay = scalar(
      "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses WHERE date LIKE ?",
      `${DATE}%`,
    ).v;
    const expMonth = scalar(
      "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses WHERE date LIKE ?",
      `${MONTH}%`,
    ).v;
    const unpaidBills = scalar(
      "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM bills WHERE paid = 0",
    ).v;
    const unpaidPayables = scalar(
      "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM payables WHERE paid = 0",
    ).v;
    const outstanding = scalar(
      "SELECT COALESCE(SUM(balance_cents), 0) AS v FROM loans WHERE balance_cents > 0",
    ).v;

    // Known fixture values pin the voided/out-of-window exclusions.
    expect({ dayCash, dayGcash, dayCount }).toEqual({
      dayCash: 10000,
      dayGcash: 3800,
      dayCount: 2,
    });
    expect({ monthCash, monthGcash, monthCount }).toEqual({
      monthCash: 26500,
      monthGcash: 3800,
      monthCount: 3,
    });
    expect({ expDay, expMonth }).toEqual({ expDay: 4000, expMonth: 5000 });
    expect(unpaidBills).toBe(300000);
    expect(unpaidPayables).toBe(100000);
    expect(outstanding).toBe(90000);

    expect(body.income_day).toEqual({
      cash_cents: dayCash,
      gcash_cents: dayGcash,
      total_cents: dayCash + dayGcash,
      count: dayCount,
    });
    expect(body.income_month).toEqual({
      cash_cents: monthCash,
      gcash_cents: monthGcash,
      total_cents: monthCash + monthGcash,
      count: monthCount,
    });
    expect(body.expenses_day_cents).toBe(expDay);
    expect(body.expenses_month_cents).toBe(expMonth);
    // Net rule: income totals minus expenses only; stocks stay separate.
    expect(body.net_day_cents).toBe(dayCash + dayGcash - expDay);
    expect(body.net_month_cents).toBe(monthCash + monthGcash - expMonth);
    expect(body.net_day_cents).toBe(9800);
    expect(body.net_month_cents).toBe(25300);
    expect(body.unpaid_bills_cents).toBe(unpaidBills);
    expect(body.unpaid_payables_cents).toBe(unpaidPayables);
    expect(body.outstanding_loans_cents).toBe(outstanding);
  });

  it("upcoming dues: all unpaid bills (padded due_day) + unpaid payables within date+7, sorted by due", async () => {
    const res = await api
      .get(`/api/dashboard?date=${DATE}&month=${MONTH}`)
      .expect(200);
    // Cutoff 2026-10-20: Today Due (edge in), Week Due (edge in),
    // Overdue (no lower bound), Later Due 10-21 out, Paid Due out.
    expect(res.body.upcoming_dues).toEqual([
      { kind: "bill", label: "Meralco", amount_cents: 250000, due: "05" },
      { kind: "bill", label: "Water", amount_cents: 50000, due: "20" },
      {
        kind: "payable",
        label: "Overdue",
        amount_cents: 40000,
        due: "2026-10-01",
      },
      {
        kind: "payable",
        label: "Today Due",
        amount_cents: 10000,
        due: "2026-10-13",
      },
      {
        kind: "payable",
        label: "Week Due",
        amount_cents: 20000,
        due: "2026-10-20",
      },
    ]);
  });

  it("loans list holds balance>0 only; paid-off loan excluded from list and sum", async () => {
    const res = await api
      .get(`/api/dashboard?date=${DATE}&month=${MONTH}`)
      .expect(200);
    expect(res.body.outstanding_loans_cents).toBe(90000);
    expect(res.body.loans).toHaveLength(1);
    expect(res.body.loans[0]).toMatchObject({
      lender: "BDO",
      balance_cents: 90000,
    });
    expect(res.body.loans[0].id).toEqual(expect.any(Number));
    expect(Object.keys(res.body.loans[0]).sort()).toEqual([
      "balance_cents",
      "id",
      "lender",
    ]);
  });

  it("best sellers: top 5 by qty in month, voided + out-of-month excluded, qty ties by revenue desc", async () => {
    const res = await api
      .get(`/api/dashboard?date=${DATE}&month=${MONTH}`)
      .expect(200);
    // Item Six has 100 voided units (would rank #1 if counted) and only 1
    // real unit; Item One has 100 September units outside the month.
    expect(res.body.best_sellers).toEqual([
      { menu_item_id: ids.i1, name: "Item One", qty: 10, revenue_cents: 10000 },
      { menu_item_id: ids.i2, name: "Item Two", qty: 8, revenue_cents: 16000 },
      { menu_item_id: ids.i3, name: "Item Three", qty: 8, revenue_cents: 800 },
      { menu_item_id: ids.i4, name: "Item Four", qty: 5, revenue_cents: 2500 },
      { menu_item_id: ids.i5, name: "Item Five", qty: 3, revenue_cents: 900 },
    ]);
  });

  it("defaults date+month to today UTC; 400 on malformed date or month", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const def = await api.get("/api/dashboard").expect(200);
    expect(def.body.date).toBe(today);
    expect(def.body.month).toBe(today.slice(0, 7));
    for (const qs of [
      "date=not-a-date&month=2026-10",
      "date=2026-13-01&month=2026-10",
      "date=2026-02-30&month=2026-10",
      "date=2026-10-13&month=october",
      "date=2026-10-13&month=2026-13",
      "date=2026-10-13&month=2026-1",
    ]) {
      const bad = await api.get(`/api/dashboard?${qs}`).expect(400);
      expect(bad.body.error).toEqual(expect.any(String));
    }
  });
});
