import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-loans-api-test-"));
const app = createApp(join(dir, "loans-api-test.db"));

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

function loanInput(overrides = {}) {
  return {
    lender: "BDO",
    principal_cents: 100000,
    balance_cents: 100000,
    installment_cents: 10000,
    due_day: 15,
    ...overrides,
  };
}

async function createLoan(overrides = {}) {
  return (
    await request(app).post("/api/loans").send(loanInput(overrides)).expect(201)
  ).body;
}

describe("loans CRUD (Task 12)", () => {
  it("POST creates a loan -> 201 with round-trip fields", async () => {
    const res = await request(app)
      .post("/api/loans")
      .send(loanInput({ lender: "Metrobank" }))
      .expect(201);
    expect(res.body).toMatchObject({
      lender: "Metrobank",
      principal_cents: 100000,
      balance_cents: 100000,
      installment_cents: 10000,
      due_day: 15,
    });
    expect(res.body.id).toEqual(expect.any(Number));
  });

  it("POST validates: lender, principal/balance/installment, due_day -> 400 {error}", async () => {
    const bad = [
      {},
      { principal_cents: 100, balance_cents: 100, installment_cents: 10, due_day: 5 },
      { lender: "  ", principal_cents: 100, balance_cents: 100, installment_cents: 10, due_day: 5 },
      { lender: "X", principal_cents: -1, balance_cents: 100, installment_cents: 10, due_day: 5 },
      { lender: "X", principal_cents: 10.5, balance_cents: 100, installment_cents: 10, due_day: 5 },
      { lender: "X", principal_cents: "100", balance_cents: 100, installment_cents: 10, due_day: 5 },
      { lender: "X", principal_cents: 100, balance_cents: -1, installment_cents: 10, due_day: 5 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: 0, due_day: 5 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: -5, due_day: 5 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: 2.5, due_day: 5 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: 10 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: 10, due_day: 0 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: 10, due_day: 32 },
      { lender: "X", principal_cents: 100, balance_cents: 100, installment_cents: 10, due_day: "15" },
    ];
    for (const body of bad) {
      const res = await request(app).post("/api/loans").send(body).expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("POST defaults omitted balance_cents to principal_cents", async () => {
    const res = await request(app)
      .post("/api/loans")
      .send({ lender: "Default Balance", principal_cents: 60000, installment_cents: 6000, due_day: 10 })
      .expect(201);
    expect(res.body).toMatchObject({
      lender: "Default Balance",
      principal_cents: 60000,
      balance_cents: 60000,
    });
  });

  it("installment_cents of 0 is rejected -> 400", async () => {
    const res = await request(app)
      .post("/api/loans")
      .send(loanInput({ lender: "Zero Installment", installment_cents: 0 }))
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("GET list contains created rows; GET :id round-trips; unknown -> 404", async () => {
    const created = await createLoan({ lender: "Roundtrip Lender" });
    const list = await request(app).get("/api/loans").expect(200);
    expect(list.body.find((row) => row.id === created.id)).toMatchObject({
      lender: "Roundtrip Lender",
    });
    const fetched = await request(app)
      .get(`/api/loans/${created.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ lender: "Roundtrip Lender" });
    await request(app).get("/api/loans/999999").expect(404);
    await request(app).get("/api/loans/abc").expect(404);
  });

  it("PATCH applies any subset with the same rules; bad values -> 400; unknown -> 404", async () => {
    const created = await createLoan({ lender: "Patch Lender" });
    const patched = await request(app)
      .patch(`/api/loans/${created.id}`)
      .send({ due_day: 1, installment_cents: 5000 })
      .expect(200);
    expect(patched.body).toMatchObject({
      lender: "Patch Lender",
      principal_cents: 100000,
      balance_cents: 100000,
      installment_cents: 5000,
      due_day: 1,
    });
    for (const body of [
      { lender: "  " },
      { principal_cents: -1 },
      { balance_cents: -1 },
      { installment_cents: 0 },
      { due_day: 99 },
    ]) {
      const res = await request(app)
        .patch(`/api/loans/${created.id}`)
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    await request(app)
      .patch("/api/loans/999999")
      .send({ due_day: 5 })
      .expect(404);
  });

  it("?outstanding=1 returns only loans with balance_cents > 0", async () => {
    const outstanding = await createLoan({ lender: "Outstanding Lender" });
    const settled = await createLoan({
      lender: "Settled Lender",
      balance_cents: 0,
    });
    const res = await request(app).get("/api/loans?outstanding=1").expect(200);
    const ids = res.body.map((row) => row.id);
    expect(ids).toContain(outstanding.id);
    expect(ids).not.toContain(settled.id);
    for (const row of res.body) {
      expect(row.balance_cents).toBeGreaterThan(0);
    }
    const bad = await request(app).get("/api/loans?outstanding=2").expect(400);
    expect(bad.body.error).toEqual(expect.any(String));
  });

  it("DELETE with balance -> 400 and the loan survives; DELETE at zero -> 204 with payments", async () => {
    const owing = await createLoan({ lender: "Owing Lender" });
    const blocked = await request(app)
      .delete(`/api/loans/${owing.id}`)
      .expect(400);
    expect(blocked.body.error).toEqual(expect.any(String));
    await request(app).get(`/api/loans/${owing.id}`).expect(200);

    const clear = await createLoan({ lender: "Clear Lender" });
    await request(app)
      .post(`/api/loans/${clear.id}/payments`)
      .send({ amount_cents: 100000 })
      .expect(201);
    await request(app).delete(`/api/loans/${clear.id}`).expect(204);
    await request(app).get(`/api/loans/${clear.id}`).expect(404);
    await request(app).get(`/api/loans/${clear.id}/payments`).expect(404);
    await request(app).delete("/api/loans/999999").expect(404);
  });
});

describe("loan payments (Task 12)", () => {
  it("pay drops balance and history grows in one call -> 201 {payment, balance_cents}", async () => {
    const loan = await createLoan({ lender: "Paydown Lender" });
    const res = await request(app)
      .post(`/api/loans/${loan.id}/payments`)
      .send({ amount_cents: 10000 })
      .expect(201);
    expect(res.body.balance_cents).toBe(90000);
    expect(res.body.payment).toMatchObject({
      loan_id: loan.id,
      amount_cents: 10000,
    });
    expect(res.body.payment.id).toEqual(expect.any(Number));
    expect(res.body.payment.paid_at).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    const fetched = await request(app)
      .get(`/api/loans/${loan.id}`)
      .expect(200);
    expect(fetched.body.balance_cents).toBe(90000);
    const history = await request(app)
      .get(`/api/loans/${loan.id}/payments`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({
      loan_id: loan.id,
      amount_cents: 10000,
    });
  });

  it("overpay -> 400 with balance unchanged", async () => {
    const loan = await createLoan({
      lender: "Overpay Lender",
      principal_cents: 5000,
      balance_cents: 5000,
      installment_cents: 1000,
    });
    await request(app)
      .post(`/api/loans/${loan.id}/payments`)
      .send({ amount_cents: 1000 })
      .expect(201);
    const res = await request(app)
      .post(`/api/loans/${loan.id}/payments`)
      .send({ amount_cents: 5000 })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
    const fetched = await request(app)
      .get(`/api/loans/${loan.id}`)
      .expect(200);
    expect(fetched.body.balance_cents).toBe(4000);
    const history = await request(app)
      .get(`/api/loans/${loan.id}/payments`)
      .expect(200);
    expect(history.body).toHaveLength(1);
  });

  it("unknown loan -> 404 on POST payment and GET history", async () => {
    await request(app)
      .post("/api/loans/999999/payments")
      .send({ amount_cents: 100 })
      .expect(404);
    await request(app).get("/api/loans/999999/payments").expect(404);
    await request(app)
      .post("/api/loans/abc/payments")
      .send({ amount_cents: 100 })
      .expect(404);
  });

  it("payment amount must be a positive integer -> 400 {error}", async () => {
    const loan = await createLoan({ lender: "Amount Check Lender" });
    for (const body of [
      {},
      { amount_cents: 0 },
      { amount_cents: -100 },
      { amount_cents: 10.5 },
      { amount_cents: "100" },
    ]) {
      const res = await request(app)
        .post(`/api/loans/${loan.id}/payments`)
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    const fetched = await request(app)
      .get(`/api/loans/${loan.id}`)
      .expect(200);
    expect(fetched.body.balance_cents).toBe(100000);
  });

  it("history is latest-first (paid_at DESC, id DESC)", async () => {
    const loan = await createLoan({ lender: "History Lender" });
    const first = (
      await request(app)
        .post(`/api/loans/${loan.id}/payments`)
        .send({ amount_cents: 1000 })
        .expect(201)
    ).body.payment;
    const second = (
      await request(app)
        .post(`/api/loans/${loan.id}/payments`)
        .send({ amount_cents: 2000 })
        .expect(201)
    ).body.payment;
    const history = await request(app)
      .get(`/api/loans/${loan.id}/payments`)
      .expect(200);
    expect(history.body.map((row) => row.id)).toEqual([second.id, first.id]);
  });
});
