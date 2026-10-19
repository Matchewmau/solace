import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-bills-recurring-test-"));
const app = createApp(join(dir, "bills-recurring-test.db"));
const api = authed(app);

const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function createBill(overrides = {}) {
  return (
    await api
      .post("/api/bills")
      .send({
        name: "Bill",
        amount_cents: 1000,
        due_date: "2026-11-01",
        ...overrides,
      })
      .expect(201)
  ).body;
}

async function listBills() {
  return (await api.get("/api/bills").expect(200)).body;
}

describe("recurring bills", () => {
  it("creates a weekly bill with due date, end date, and alert days", async () => {
    const created = await createBill({
      name: "Weekly Milk",
      amount_cents: 120000,
      due_date: "2026-11-02",
      frequency: "weekly",
      end_date: "2026-12-31",
      alert_days: 5,
    });
    expect(created).toMatchObject({
      name: "Weekly Milk",
      amount_cents: 120000,
      due_date: "2026-11-02",
      due_day: 2,
      frequency: "weekly",
      end_date: "2026-12-31",
      alert_days: 5,
      paid: 0,
      paid_at: null,
      source_bill_id: null,
    });
    expect(created.id).toEqual(expect.any(Number));
    expect(created.series_id).toBe(created.id);
  });

  it("marks a bill paid and creates the next weekly occurrence with source_bill_id", async () => {
    const parent = await createBill({
      name: "Weekly Rent",
      amount_cents: 90000,
      due_date: "2026-11-02",
      frequency: "weekly",
      alert_days: 2,
    });
    const paid = await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(paid.body.paid).toBe(1);
    expect(paid.body.paid_at).toMatch(STAMP_RE);

    const children = (await listBills()).filter(
      (row) => row.source_bill_id === parent.id,
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      name: "Weekly Rent",
      amount_cents: 90000,
      due_date: "2026-11-09",
      due_day: 9,
      frequency: "weekly",
      end_date: null,
      alert_days: 2,
      paid: 0,
      paid_at: null,
      series_id: parent.series_id,
      source_bill_id: parent.id,
    });
  });

  it("advances a monthly bill and clamps a Jan 31 due date to Feb 28", async () => {
    const parent = await createBill({
      name: "Month End",
      amount_cents: 4200,
      due_date: "2027-01-31",
    });
    await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 1 })
      .expect(200);
    const child = (await listBills()).find(
      (row) => row.source_bill_id === parent.id,
    );
    expect(child).toMatchObject({
      due_date: "2027-02-28",
      due_day: 28,
      frequency: "monthly",
    });
  });

  it("does not create an occurrence past the inclusive end date", async () => {
    const inclusive = await createBill({
      name: "Inclusive End",
      amount_cents: 100,
      due_date: "2026-11-30",
      end_date: "2026-12-30",
    });
    await api
      .patch(`/api/bills/${inclusive.id}`)
      .send({ paid: 1 })
      .expect(200);
    let rows = await listBills();
    expect(
      rows.find((row) => row.source_bill_id === inclusive.id),
    ).toMatchObject({ due_date: "2026-12-30" });

    const past = await createBill({
      name: "Past End",
      amount_cents: 100,
      due_date: "2026-11-30",
      end_date: "2026-12-29",
    });
    await api.patch(`/api/bills/${past.id}`).send({ paid: 1 }).expect(200);
    rows = await listBills();
    expect(rows.filter((row) => row.source_bill_id === past.id)).toHaveLength(
      0,
    );
  });

  it("unpaying removes the unpaid next occurrence", async () => {
    const parent = await createBill({
      name: "Unpay Me",
      due_date: "2026-11-04",
    });
    await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 1 })
      .expect(200);
    const child = (await listBills()).find(
      (row) => row.source_bill_id === parent.id,
    );
    expect(child).toBeDefined();

    const unpay = await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 0 })
      .expect(200);
    expect(unpay.body).toMatchObject({ paid: 0, paid_at: null });
    await api.get(`/api/bills/${child.id}`).expect(404);
  });

  it("refuses to unpay after the next occurrence is paid", async () => {
    const parent = await createBill({
      name: "Paid Ahead",
      due_date: "2026-11-05",
    });
    await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 1 })
      .expect(200);
    const child = (await listBills()).find(
      (row) => row.source_bill_id === parent.id,
    );
    await api
      .patch(`/api/bills/${child.id}`)
      .send({ paid: 1 })
      .expect(200);

    const res = await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 0 })
      .expect(400);
    expect(res.body.error).toBe("cannot unpay after the next cycle is paid");

    const parentAfter = await api
      .get(`/api/bills/${parent.id}`)
      .expect(200);
    expect(parentAfter.body.paid).toBe(1);
    const childAfter = await api.get(`/api/bills/${child.id}`).expect(200);
    expect(childAfter.body.paid).toBe(1);
  });

  it("marking paid twice does not duplicate the next occurrence", async () => {
    const parent = await createBill({
      name: "Double Tap",
      due_date: "2026-11-06",
    });
    const first = await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 1 })
      .expect(200);
    const second = await api
      .patch(`/api/bills/${parent.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(second.body.paid_at).toBe(first.body.paid_at);

    const children = (await listBills()).filter(
      (row) => row.source_bill_id === parent.id,
    );
    expect(children).toHaveLength(1);
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
      { paid: 2 },
    ];
    for (const overrides of bad) {
      const res = await api
        .post("/api/bills")
        .send({
          name: "Bad Bill",
          amount_cents: 100,
          due_date: "2026-11-01",
          ...overrides,
        })
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }

    const created = await createBill({ name: "Patch Bad" });
    const badPatches = [
      { frequency: "daily" },
      { alert_days: 0 },
      { due_date: "nope" },
      { end_date: "2026-10-31" },
    ];
    for (const overrides of badPatches) {
      const res = await api
        .patch(`/api/bills/${created.id}`)
        .send(overrides)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("filters by paid and due_before", async () => {
    const unpaid = await createBill({
      name: "Unpaid Due",
      amount_cents: 100,
      due_date: "2026-11-07",
    });
    const paid = await createBill({
      name: "Paid Due",
      amount_cents: 100,
      due_date: "2026-11-08",
      paid: 1,
    });

    const unpaidList = await api.get("/api/bills?paid=0").expect(200);
    const unpaidIds = unpaidList.body.map((row) => row.id);
    expect(unpaidIds).toContain(unpaid.id);
    expect(unpaidIds).not.toContain(paid.id);

    const paidList = await api.get("/api/bills?paid=1").expect(200);
    const paidIds = paidList.body.map((row) => row.id);
    expect(paidIds).toContain(paid.id);
    expect(paidIds).not.toContain(unpaid.id);

    const dueList = await api
      .get("/api/bills?due_before=2026-11-08")
      .expect(200);
    const dueIds = dueList.body.map((row) => row.id);
    expect(dueIds).toContain(unpaid.id);
    expect(dueIds).toContain(paid.id);
    for (const row of dueList.body) {
      expect(row.due_date <= "2026-11-08").toBe(true);
    }

    await api.get("/api/bills?paid=2").expect(400);
    await api.get("/api/bills?due_before=2026-02-30").expect(400);
  });

  it("an old DB with due_day NOT NULL accepts a new bill after migration", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "solace-bills-legacy-"));
    const legacyPath = join(legacyDir, "legacy.db");
    try {
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE bills (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_day INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0)",
      );
      legacy
        .prepare(
          "INSERT INTO bills (name, amount_cents, due_day, paid) VALUES (?, ?, ?, ?)",
        )
        .run("Legacy Bill", 1000, 15, 0);
      legacy.close();

      const legacyApp = createApp(legacyPath);
      try {
        const legacyApi = authed(legacyApp);
        const res = await legacyApi
          .post("/api/bills")
          .send({
            name: "Migrated Bill",
            amount_cents: 500,
            due_date: "2026-11-20",
          })
          .expect(201);
        expect(res.body).toMatchObject({
          name: "Migrated Bill",
          amount_cents: 500,
          due_date: "2026-11-20",
          due_day: 20,
          frequency: "monthly",
          end_date: null,
          alert_days: 3,
          paid: 0,
          paid_at: null,
          source_bill_id: null,
        });
        expect(res.body.series_id).toBe(res.body.id);

        const legacyRow = await legacyApi.get("/api/bills/1").expect(200);
        expect(legacyRow.body.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(legacyRow.body.due_day).toBe(15);
        expect(legacyRow.body.series_id).toBe(1);

        const index = legacyApp.locals.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_bills_due_date'",
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
});
