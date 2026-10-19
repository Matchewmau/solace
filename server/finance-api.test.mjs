import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-finance-api-test-"));
const app = createApp(join(dir, "finance-api-test.db"));
const api = authed(app);

const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

function shiftUTC(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

describe("bills CRUD (Task 11)", () => {
  it("POST creates a bill -> 201 with round-trip fields", async () => {
    const res = await api
      .post("/api/bills")
      .send({ name: "Meralco", amount_cents: 250000, due_date: "2026-11-15" })
      .expect(201);
    expect(res.body).toMatchObject({
      name: "Meralco",
      amount_cents: 250000,
      due_date: "2026-11-15",
      due_day: 15,
      frequency: "monthly",
      end_date: null,
      alert_days: 3,
      paid: 0,
      paid_at: null,
      source_bill_id: null,
    });
    expect(res.body.id).toEqual(expect.any(Number));
    expect(res.body.series_id).toBe(res.body.id);
  });

  it("POST validates: name, amount_cents, due_date, frequency, end_date, alert_days, paid -> 400 {error}", async () => {
    const bad = [
      {},
      { amount_cents: 100, due_date: "2026-11-05" },
      { name: "  ", amount_cents: 100, due_date: "2026-11-05" },
      { name: "Water", amount_cents: -1, due_date: "2026-11-05" },
      { name: "Water", amount_cents: 10.5, due_date: "2026-11-05" },
      { name: "Water", amount_cents: "100", due_date: "2026-11-05" },
      { name: "Water", amount_cents: 100 },
      { name: "Water", amount_cents: 100, due_date: "2026-02-30" },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        frequency: "daily",
      },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        end_date: "2026-11-04",
      },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        end_date: "tomorrow",
      },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        alert_days: 0,
      },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        alert_days: 31,
      },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        alert_days: "3",
      },
      {
        name: "Water",
        amount_cents: 100,
        due_date: "2026-11-05",
        paid: 2,
      },
    ];
    for (const body of bad) {
      const res = await api.post("/api/bills").send(body).expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("GET list contains created rows; GET :id round-trips; unknown -> 404", async () => {
    const created = (
      await api
        .post("/api/bills")
        .send({ name: "Internet", amount_cents: 150000, due_date: "2026-11-10" })
        .expect(201)
    ).body;
    const list = await api.get("/api/bills").expect(200);
    expect(
      list.body.find((row) => row.id === created.id),
    ).toMatchObject({ name: "Internet", due_date: "2026-11-10", due_day: 10 });
    const fetched = await api
      .get(`/api/bills/${created.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ name: "Internet" });
    await api.get("/api/bills/999999").expect(404);
    await api.get("/api/bills/abc").expect(404);
  });

  it("PATCH toggles paid and preserves the rest; bad values -> 400", async () => {
    const created = (
      await api
        .post("/api/bills")
        .send({ name: "Rent", amount_cents: 500000, due_date: "2026-11-01" })
        .expect(201)
    ).body;
    const patched = await api
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: "Rent",
      amount_cents: 500000,
      due_date: "2026-11-01",
      due_day: 1,
      paid: 1,
    });
    await api
      .patch(`/api/bills/${created.id}`)
      .send({ due_date: "2026-99-01" })
      .expect(400);
    await api
      .patch(`/api/bills/${created.id}`)
      .send({ amount_cents: -5 })
      .expect(400);
    await api
      .patch("/api/bills/999999")
      .send({ paid: 1 })
      .expect(404);
  });

  it("DELETE -> 204, then GET -> 404; unknown -> 404", async () => {
    const doomed = (
      await api
        .post("/api/bills")
        .send({ name: "Doomed Bill", amount_cents: 100, due_date: "2026-11-20" })
        .expect(201)
    ).body;
    await api.delete(`/api/bills/${doomed.id}`).expect(204);
    await api.get(`/api/bills/${doomed.id}`).expect(404);
    await api.delete("/api/bills/999999").expect(404);
  });

  it("?paid filters; ?due_before filters; bad filter values -> 400", async () => {
    const unpaid = (
      await api
        .post("/api/bills")
        .send({ name: "Unpaid Filter", amount_cents: 100, due_date: "2026-11-07" })
        .expect(201)
    ).body;
    const paid = (
      await api
        .post("/api/bills")
        .send({
          name: "Paid Filter",
          amount_cents: 100,
          due_date: "2026-11-08",
          paid: 1,
        })
        .expect(201)
    ).body;
    const unpaidList = await api.get("/api/bills?paid=0").expect(200);
    expect(unpaidList.body.map((row) => row.id)).toContain(unpaid.id);
    expect(unpaidList.body.map((row) => row.id)).not.toContain(paid.id);
    const paidList = await api.get("/api/bills?paid=1").expect(200);
    expect(paidList.body.map((row) => row.id)).toContain(paid.id);
    expect(paidList.body.map((row) => row.id)).not.toContain(unpaid.id);
    const dueList = await api
      .get("/api/bills?due_before=2026-11-08")
      .expect(200);
    expect(dueList.body.map((row) => row.id)).toContain(unpaid.id);
    expect(dueList.body.map((row) => row.id)).toContain(paid.id);
    for (const row of dueList.body) {
      expect(row.due_date <= "2026-11-08").toBe(true);
    }
    const badPaid = await api.get("/api/bills?paid=2").expect(400);
    expect(badPaid.body.error).toEqual(expect.any(String));
    const badDate = await api
      .get("/api/bills?due_before=2026-02-30")
      .expect(400);
    expect(badDate.body.error).toEqual(expect.any(String));
  });
});

describe("expenses CRUD (Task 11)", () => {
  it("POST creates with note default '' -> 201; round-trips", async () => {
    const res = await api
      .post("/api/expenses")
      .send({ date: "2026-10-12", category: "Beans", amount_cents: 120000 })
      .expect(201);
    expect(res.body).toMatchObject({
      date: "2026-10-12",
      category: "Beans",
      amount_cents: 120000,
      note: "",
    });
    expect(res.body.id).toEqual(expect.any(Number));

    const noted = await api
      .post("/api/expenses")
      .send({
        date: "2026-10-12",
        category: "Milk",
        amount_cents: 50000,
        note: "Arla 6L",
      })
      .expect(201);
    expect(noted.body.note).toBe("Arla 6L");
  });

  it("POST validates: date, category, amount_cents -> 400 {error}", async () => {
    const bad = [
      {},
      { category: "Beans", amount_cents: 100 },
      { date: "not-a-date", category: "Beans", amount_cents: 100 },
      { date: "2026-13-01", category: "Beans", amount_cents: 100 },
      { date: "2026-02-30", category: "Beans", amount_cents: 100 },
      { date: "2026-10-12", amount_cents: 100 },
      { date: "2026-10-12", category: "  ", amount_cents: 100 },
      { date: "2026-10-12", category: "Beans", amount_cents: -1 },
      { date: "2026-10-12", category: "Beans", amount_cents: 1.5 },
    ];
    for (const body of bad) {
      const res = await api
        .post("/api/expenses")
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("GET / PATCH / DELETE round-trip; unknown ids -> 404", async () => {
    const created = (
      await api
        .post("/api/expenses")
        .send({ date: "2026-10-11", category: "Sugar", amount_cents: 20000 })
        .expect(201)
    ).body;
    const fetched = await api
      .get(`/api/expenses/${created.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ category: "Sugar" });
    await api.get("/api/expenses/999999").expect(404);

    const patched = await api
      .patch(`/api/expenses/${created.id}`)
      .send({ note: "updated", amount_cents: 21000 })
      .expect(200);
    expect(patched.body).toMatchObject({
      date: "2026-10-11",
      category: "Sugar",
      amount_cents: 21000,
      note: "updated",
    });
    await api
      .patch(`/api/expenses/${created.id}`)
      .send({ date: "bad-date" })
      .expect(400);
    await api
      .patch("/api/expenses/999999")
      .send({ note: "x" })
      .expect(404);

    await api.delete(`/api/expenses/${created.id}`).expect(204);
    await api.get(`/api/expenses/${created.id}`).expect(404);
    await api.delete("/api/expenses/999999").expect(404);
  });
});

describe("payables CRUD + due filters (Task 11)", () => {
  it("POST creates a payable -> 201; GET :id round-trips", async () => {
    const res = await api
      .post("/api/payables")
      .send({ label: "Supplier Ana", amount_cents: 80000, due_date: shiftUTC(3) })
      .expect(201);
    expect(res.body).toMatchObject({
      label: "Supplier Ana",
      amount_cents: 80000,
      paid: 0,
    });
    expect(res.body.id).toEqual(expect.any(Number));
    const fetched = await api
      .get(`/api/payables/${res.body.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ label: "Supplier Ana" });
  });

  it("POST validates: label, amount_cents, due_date, paid -> 400 {error}", async () => {
    const bad = [
      {},
      { amount_cents: 100, due_date: shiftUTC(1) },
      { label: "  ", amount_cents: 100, due_date: shiftUTC(1) },
      { label: "X", amount_cents: -1, due_date: shiftUTC(1) },
      { label: "X", amount_cents: 100 },
      { label: "X", amount_cents: 100, due_date: "tomorrow" },
      { label: "X", amount_cents: 100, due_date: "2026-02-30" },
      { label: "X", amount_cents: 100, due_date: shiftUTC(1), paid: 2 },
    ];
    for (const body of bad) {
      const res = await api
        .post("/api/payables")
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    await api.get("/api/payables/abc").expect(404);
  });

  it("PATCH toggles paid; DELETE -> 204 then 404", async () => {
    const created = (
      await api
        .post("/api/payables")
        .send({ label: "Toggle Me", amount_cents: 5000, due_date: shiftUTC(2) })
        .expect(201)
    ).body;
    const patched = await api
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(patched.body.paid).toBe(1);
    expect(patched.body.label).toBe("Toggle Me");
    await api
      .patch(`/api/payables/${created.id}`)
      .send({ due_date: "bad" })
      .expect(400);
    await api.patch("/api/payables/999999").send({ paid: 1 }).expect(404);
    await api.delete(`/api/payables/${created.id}`).expect(204);
    await api.get(`/api/payables/${created.id}`).expect(404);
  });

  it("?paid=0|1 filters; bad paid -> 400", async () => {
    const unpaid = (
      await api
        .post("/api/payables")
        .send({ label: "Unpaid P", amount_cents: 100, due_date: shiftUTC(5) })
        .expect(201)
    ).body;
    const paid = (
      await api
        .post("/api/payables")
        .send({
          label: "Paid P",
          amount_cents: 100,
          due_date: shiftUTC(5),
          paid: 1,
        })
        .expect(201)
    ).body;
    const unpaidList = await api.get("/api/payables?paid=0").expect(200);
    expect(unpaidList.body.map((row) => row.id)).toContain(unpaid.id);
    expect(unpaidList.body.map((row) => row.id)).not.toContain(paid.id);
    const badPaid = await api.get("/api/payables?paid=no").expect(400);
    expect(badPaid.body.error).toEqual(expect.any(String));
  });

  it("?overdue=1 returns only unpaid rows with due_date < today-UTC", async () => {
    const overdue = (
      await api
        .post("/api/payables")
        .send({
          label: "Overdue Supplier",
          amount_cents: 1000,
          due_date: shiftUTC(-1),
        })
        .expect(201)
    ).body;
    const upcoming = (
      await api
        .post("/api/payables")
        .send({
          label: "Upcoming Supplier",
          amount_cents: 1000,
          due_date: shiftUTC(1),
        })
        .expect(201)
    ).body;
    const paidOverdue = (
      await api
        .post("/api/payables")
        .send({
          label: "Paid Late Supplier",
          amount_cents: 1000,
          due_date: shiftUTC(-1),
          paid: 1,
        })
        .expect(201)
    ).body;
    const res = await api.get("/api/payables?overdue=1").expect(200);
    const ids = res.body.map((row) => row.id);
    expect(ids).toContain(overdue.id);
    expect(ids).not.toContain(upcoming.id);
    expect(ids).not.toContain(paidOverdue.id);
    for (const row of res.body) {
      expect(row.paid).toBe(0);
    }
  });

  it("?due_before=YYYY-MM-DD returns due_date <= param; bad date -> 400", async () => {
    const early = (
      await api
        .post("/api/payables")
        .send({
          label: "Early Due",
          amount_cents: 100,
          due_date: shiftUTC(-2),
        })
        .expect(201)
    ).body;
    const late = (
      await api
        .post("/api/payables")
        .send({
          label: "Late Due",
          amount_cents: 100,
          due_date: shiftUTC(2),
        })
        .expect(201)
    ).body;
    const cutoff = shiftUTC(0);
    const res = await api
      .get(`/api/payables?due_before=${cutoff}`)
      .expect(200);
    const ids = res.body.map((row) => row.id);
    expect(ids).toContain(early.id);
    expect(ids).not.toContain(late.id);
    const bad = await api
      .get("/api/payables?due_before=not-a-date")
      .expect(400);
    expect(bad.body.error).toEqual(expect.any(String));
  });
});

describe("bill payment dates (Task 7)", () => {
  it("POST unpaid -> paid_at null; PATCH paid:1 stamps YYYY-MM-DD HH:MM:SS", async () => {
    const created = (
      await api
        .post("/api/bills")
        .send({ name: "Stamp Bill", amount_cents: 1000, due_date: "2026-11-03" })
        .expect(201)
    ).body;
    expect(created.paid_at).toBeNull();

    const stamped = await api
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(stamped.body.paid_at).toMatch(STAMP_RE);
  });

  it("PATCH paid:1 again keeps the existing paid_at", async () => {
    const created = (
      await api
        .post("/api/bills")
        .send({ name: "Keep Bill", amount_cents: 1000, due_date: "2026-11-03" })
        .expect(201)
    ).body;
    const first = await api
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(first.body.paid_at).toMatch(STAMP_RE);

    const second = await api
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(second.body.paid_at).toBe(first.body.paid_at);

    // Pin a sentinel so a same-second re-stamp cannot mask a kept value.
    app.locals.db
      .prepare("UPDATE bills SET paid_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", created.id);
    const third = await api
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(third.body.paid_at).toBe("2000-01-01 00:00:00");

    // An unrelated patch (paid stays 1) must not restamp either.
    const renamed = await api
      .patch(`/api/bills/${created.id}`)
      .send({ name: "Keep Bill Renamed" })
      .expect(200);
    expect(renamed.body.paid_at).toBe("2000-01-01 00:00:00");
  });

  it("PATCH paid:0 clears paid_at back to null", async () => {
    const created = (
      await api
        .post("/api/bills")
        .send({
          name: "Clear Bill",
          amount_cents: 1000,
          due_date: "2026-11-03",
          paid: 1,
        })
        .expect(201)
    ).body;
    expect(created.paid_at).toMatch(STAMP_RE);

    const cleared = await api
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 0 })
      .expect(200);
    expect(cleared.body.paid).toBe(0);
    expect(cleared.body.paid_at).toBeNull();
  });
});

describe("payable payment dates (Task 7)", () => {
  it("POST unpaid -> paid_at null; PATCH paid:1 stamps YYYY-MM-DD HH:MM:SS", async () => {
    const created = (
      await api
        .post("/api/payables")
        .send({ label: "Stamp Payable", amount_cents: 1000, due_date: shiftUTC(4) })
        .expect(201)
    ).body;
    expect(created.paid_at).toBeNull();

    const stamped = await api
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(stamped.body.paid_at).toMatch(STAMP_RE);
  });

  it("PATCH paid:1 again keeps the existing paid_at", async () => {
    const created = (
      await api
        .post("/api/payables")
        .send({ label: "Keep Payable", amount_cents: 1000, due_date: shiftUTC(4) })
        .expect(201)
    ).body;
    const first = await api
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(first.body.paid_at).toMatch(STAMP_RE);

    const second = await api
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(second.body.paid_at).toBe(first.body.paid_at);

    app.locals.db
      .prepare("UPDATE payables SET paid_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", created.id);
    const third = await api
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(third.body.paid_at).toBe("2000-01-01 00:00:00");

    const relabeled = await api
      .patch(`/api/payables/${created.id}`)
      .send({ label: "Keep Payable Renamed" })
      .expect(200);
    expect(relabeled.body.paid_at).toBe("2000-01-01 00:00:00");
  });

  it("PATCH paid:0 clears paid_at back to null", async () => {
    const created = (
      await api
        .post("/api/payables")
        .send({
          label: "Clear Payable",
          amount_cents: 1000,
          due_date: shiftUTC(4),
          paid: 1,
        })
        .expect(201)
    ).body;
    expect(created.paid_at).toMatch(STAMP_RE);

    const cleared = await api
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 0 })
      .expect(200);
    expect(cleared.body.paid).toBe(0);
    expect(cleared.body.paid_at).toBeNull();
  });
});

describe("paid_at boot migration (Task 7)", () => {
  it("pre-Change DBs gain paid_at on bills and payables (legacy rows stay null)", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "solace-finance-legacy-"));
    const legacyPath = join(legacyDir, "legacy.db");
    try {
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE bills (id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_day INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0)",
      );
      legacy.exec(
        "CREATE TABLE payables (id INTEGER PRIMARY KEY, label TEXT NOT NULL, amount_cents INTEGER NOT NULL, due_date TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0)",
      );
      legacy
        .prepare(
          "INSERT INTO bills (name, amount_cents, due_day, paid) VALUES (?, ?, ?, ?)",
        )
        .run("Legacy Bill", 1000, 3, 1);
      legacy
        .prepare(
          "INSERT INTO payables (label, amount_cents, due_date, paid) VALUES (?, ?, ?, ?)",
        )
        .run("Legacy Payable", 1000, "2026-01-05", 0);
      legacy.close();

      const legacyApp = createApp(legacyPath);
      try {
        const cols = (table) =>
          legacyApp.locals.db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((col) => col.name);
        expect(cols("bills")).toContain("paid_at");
        expect(cols("payables")).toContain("paid_at");

        const legacyApi = authed(legacyApp);
        const bills = await legacyApi.get("/api/bills").expect(200);
        expect(bills.body[0]).toMatchObject({ paid: 1, paid_at: null });

        const stamped = await legacyApi
          .patch("/api/bills/1")
          .send({ name: "Legacy Bill" })
          .expect(200);
        expect(stamped.body.paid_at).toBeNull();

        const payables = await legacyApi.get("/api/payables").expect(200);
        expect(payables.body[0]).toMatchObject({ paid: 0, paid_at: null });
        const marked = await legacyApi
          .patch("/api/payables/1")
          .send({ paid: 1 })
          .expect(200);
        expect(marked.body.paid_at).toMatch(STAMP_RE);
      } finally {
        legacyApp.locals.db.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
