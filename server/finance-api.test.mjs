import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-finance-api-test-"));
const app = createApp(join(dir, "finance-api-test.db"));

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

function shiftUTC(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

describe("bills CRUD (Task 11)", () => {
  it("POST creates a bill -> 201 with round-trip fields", async () => {
    const res = await request(app)
      .post("/api/bills")
      .send({ name: "Meralco", amount_cents: 250000, due_day: 15 })
      .expect(201);
    expect(res.body).toMatchObject({
      name: "Meralco",
      amount_cents: 250000,
      due_day: 15,
      paid: 0,
    });
    expect(res.body.id).toEqual(expect.any(Number));
  });

  it("POST validates: name, amount_cents, due_day, paid -> 400 {error}", async () => {
    const bad = [
      {},
      { amount_cents: 100, due_day: 5 },
      { name: "  ", amount_cents: 100, due_day: 5 },
      { name: "Water", amount_cents: -1, due_day: 5 },
      { name: "Water", amount_cents: 10.5, due_day: 5 },
      { name: "Water", amount_cents: "100", due_day: 5 },
      { name: "Water", amount_cents: 100 },
      { name: "Water", amount_cents: 100, due_day: 0 },
      { name: "Water", amount_cents: 100, due_day: 32 },
      { name: "Water", amount_cents: 100, due_day: "15" },
      { name: "Water", amount_cents: 100, due_day: 5, paid: 2 },
    ];
    for (const body of bad) {
      const res = await request(app).post("/api/bills").send(body).expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("GET list contains created rows; GET :id round-trips; unknown -> 404", async () => {
    const created = (
      await request(app)
        .post("/api/bills")
        .send({ name: "Internet", amount_cents: 150000, due_day: 10 })
        .expect(201)
    ).body;
    const list = await request(app).get("/api/bills").expect(200);
    expect(
      list.body.find((row) => row.id === created.id),
    ).toMatchObject({ name: "Internet", due_day: 10 });
    const fetched = await request(app)
      .get(`/api/bills/${created.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ name: "Internet" });
    await request(app).get("/api/bills/999999").expect(404);
    await request(app).get("/api/bills/abc").expect(404);
  });

  it("PATCH toggles paid and preserves the rest; bad values -> 400", async () => {
    const created = (
      await request(app)
        .post("/api/bills")
        .send({ name: "Rent", amount_cents: 500000, due_day: 1 })
        .expect(201)
    ).body;
    const patched = await request(app)
      .patch(`/api/bills/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: "Rent",
      amount_cents: 500000,
      due_day: 1,
      paid: 1,
    });
    await request(app)
      .patch(`/api/bills/${created.id}`)
      .send({ due_day: 99 })
      .expect(400);
    await request(app)
      .patch(`/api/bills/${created.id}`)
      .send({ amount_cents: -5 })
      .expect(400);
    await request(app)
      .patch("/api/bills/999999")
      .send({ paid: 1 })
      .expect(404);
  });

  it("DELETE -> 204, then GET -> 404; unknown -> 404", async () => {
    const doomed = (
      await request(app)
        .post("/api/bills")
        .send({ name: "Doomed Bill", amount_cents: 100, due_day: 20 })
        .expect(201)
    ).body;
    await request(app).delete(`/api/bills/${doomed.id}`).expect(204);
    await request(app).get(`/api/bills/${doomed.id}`).expect(404);
    await request(app).delete("/api/bills/999999").expect(404);
  });

  it("?paid filters; ?due_day=N filters; bad filter values -> 400", async () => {
    const unpaid = (
      await request(app)
        .post("/api/bills")
        .send({ name: "Unpaid Filter", amount_cents: 100, due_day: 7 })
        .expect(201)
    ).body;
    const paid = (
      await request(app)
        .post("/api/bills")
        .send({ name: "Paid Filter", amount_cents: 100, due_day: 7, paid: 1 })
        .expect(201)
    ).body;
    const unpaidList = await request(app).get("/api/bills?paid=0").expect(200);
    expect(unpaidList.body.map((row) => row.id)).toContain(unpaid.id);
    expect(unpaidList.body.map((row) => row.id)).not.toContain(paid.id);
    const paidList = await request(app).get("/api/bills?paid=1").expect(200);
    expect(paidList.body.map((row) => row.id)).toContain(paid.id);
    expect(paidList.body.map((row) => row.id)).not.toContain(unpaid.id);
    const dayList = await request(app).get("/api/bills?due_day=7").expect(200);
    expect(dayList.body.map((row) => row.id)).toContain(unpaid.id);
    expect(dayList.body.map((row) => row.id)).toContain(paid.id);
    for (const row of dayList.body) {
      expect(row.due_day).toBe(7);
    }
    const badPaid = await request(app).get("/api/bills?paid=2").expect(400);
    expect(badPaid.body.error).toEqual(expect.any(String));
    const badDay = await request(app).get("/api/bills?due_day=99").expect(400);
    expect(badDay.body.error).toEqual(expect.any(String));
  });
});

describe("expenses CRUD (Task 11)", () => {
  it("POST creates with note default '' -> 201; round-trips", async () => {
    const res = await request(app)
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

    const noted = await request(app)
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
      const res = await request(app)
        .post("/api/expenses")
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("GET / PATCH / DELETE round-trip; unknown ids -> 404", async () => {
    const created = (
      await request(app)
        .post("/api/expenses")
        .send({ date: "2026-10-11", category: "Sugar", amount_cents: 20000 })
        .expect(201)
    ).body;
    const fetched = await request(app)
      .get(`/api/expenses/${created.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ category: "Sugar" });
    await request(app).get("/api/expenses/999999").expect(404);

    const patched = await request(app)
      .patch(`/api/expenses/${created.id}`)
      .send({ note: "updated", amount_cents: 21000 })
      .expect(200);
    expect(patched.body).toMatchObject({
      date: "2026-10-11",
      category: "Sugar",
      amount_cents: 21000,
      note: "updated",
    });
    await request(app)
      .patch(`/api/expenses/${created.id}`)
      .send({ date: "bad-date" })
      .expect(400);
    await request(app)
      .patch("/api/expenses/999999")
      .send({ note: "x" })
      .expect(404);

    await request(app).delete(`/api/expenses/${created.id}`).expect(204);
    await request(app).get(`/api/expenses/${created.id}`).expect(404);
    await request(app).delete("/api/expenses/999999").expect(404);
  });
});

describe("payables CRUD + due filters (Task 11)", () => {
  it("POST creates a payable -> 201; GET :id round-trips", async () => {
    const res = await request(app)
      .post("/api/payables")
      .send({ label: "Supplier Ana", amount_cents: 80000, due_date: shiftUTC(3) })
      .expect(201);
    expect(res.body).toMatchObject({
      label: "Supplier Ana",
      amount_cents: 80000,
      paid: 0,
    });
    expect(res.body.id).toEqual(expect.any(Number));
    const fetched = await request(app)
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
      const res = await request(app)
        .post("/api/payables")
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    await request(app).get("/api/payables/abc").expect(404);
  });

  it("PATCH toggles paid; DELETE -> 204 then 404", async () => {
    const created = (
      await request(app)
        .post("/api/payables")
        .send({ label: "Toggle Me", amount_cents: 5000, due_date: shiftUTC(2) })
        .expect(201)
    ).body;
    const patched = await request(app)
      .patch(`/api/payables/${created.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(patched.body.paid).toBe(1);
    expect(patched.body.label).toBe("Toggle Me");
    await request(app)
      .patch(`/api/payables/${created.id}`)
      .send({ due_date: "bad" })
      .expect(400);
    await request(app).patch("/api/payables/999999").send({ paid: 1 }).expect(404);
    await request(app).delete(`/api/payables/${created.id}`).expect(204);
    await request(app).get(`/api/payables/${created.id}`).expect(404);
  });

  it("?paid=0|1 filters; bad paid -> 400", async () => {
    const unpaid = (
      await request(app)
        .post("/api/payables")
        .send({ label: "Unpaid P", amount_cents: 100, due_date: shiftUTC(5) })
        .expect(201)
    ).body;
    const paid = (
      await request(app)
        .post("/api/payables")
        .send({
          label: "Paid P",
          amount_cents: 100,
          due_date: shiftUTC(5),
          paid: 1,
        })
        .expect(201)
    ).body;
    const unpaidList = await request(app).get("/api/payables?paid=0").expect(200);
    expect(unpaidList.body.map((row) => row.id)).toContain(unpaid.id);
    expect(unpaidList.body.map((row) => row.id)).not.toContain(paid.id);
    const badPaid = await request(app).get("/api/payables?paid=no").expect(400);
    expect(badPaid.body.error).toEqual(expect.any(String));
  });

  it("?overdue=1 returns only unpaid rows with due_date < today-UTC", async () => {
    const overdue = (
      await request(app)
        .post("/api/payables")
        .send({
          label: "Overdue Supplier",
          amount_cents: 1000,
          due_date: shiftUTC(-1),
        })
        .expect(201)
    ).body;
    const upcoming = (
      await request(app)
        .post("/api/payables")
        .send({
          label: "Upcoming Supplier",
          amount_cents: 1000,
          due_date: shiftUTC(1),
        })
        .expect(201)
    ).body;
    const paidOverdue = (
      await request(app)
        .post("/api/payables")
        .send({
          label: "Paid Late Supplier",
          amount_cents: 1000,
          due_date: shiftUTC(-1),
          paid: 1,
        })
        .expect(201)
    ).body;
    const res = await request(app).get("/api/payables?overdue=1").expect(200);
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
      await request(app)
        .post("/api/payables")
        .send({
          label: "Early Due",
          amount_cents: 100,
          due_date: shiftUTC(-2),
        })
        .expect(201)
    ).body;
    const late = (
      await request(app)
        .post("/api/payables")
        .send({
          label: "Late Due",
          amount_cents: 100,
          due_date: shiftUTC(2),
        })
        .expect(201)
    ).body;
    const cutoff = shiftUTC(0);
    const res = await request(app)
      .get(`/api/payables?due_before=${cutoff}`)
      .expect(200);
    const ids = res.body.map((row) => row.id);
    expect(ids).toContain(early.id);
    expect(ids).not.toContain(late.id);
    const bad = await request(app)
      .get("/api/payables?due_before=not-a-date")
      .expect(400);
    expect(bad.body.error).toEqual(expect.any(String));
  });
});
