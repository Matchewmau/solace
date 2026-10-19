import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-salaries-api-test-"));
const app = createApp(join(dir, "salaries-api-test.db"));
const api = authed(app);

const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

function stamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

describe("salaries CRUD (Task 5)", () => {
  it("POST creates a salary with a UTC paid_at stamp", async () => {
    const before = stamp();
    const res = await api
      .post("/api/salaries")
      .send({
        name: "  Ana  ",
        amount_cents: 150000,
        note: "October payout",
        paid_at: "1999-01-01 00:00:00",
      })
      .expect(201);
    const after = stamp();
    expect(res.body).toMatchObject({
      name: "Ana",
      amount_cents: 150000,
      note: "October payout",
    });
    expect(res.body.id).toEqual(expect.any(Number));
    expect(res.body.paid_at).toMatch(STAMP_RE);
    // Server-stamped (UTC now), never the client-supplied value.
    expect(res.body.paid_at).not.toBe("1999-01-01 00:00:00");
    expect(res.body.paid_at >= before && res.body.paid_at <= after).toBe(true);
  });

  it("GET lists salaries newest first", async () => {
    const first = (
      await api
        .post("/api/salaries")
        .send({ name: "First", amount_cents: 1000 })
        .expect(201)
    ).body;
    const second = (
      await api
        .post("/api/salaries")
        .send({ name: "Second", amount_cents: 2000 })
        .expect(201)
    ).body;
    const list = await api.get("/api/salaries").expect(200);
    const ids = list.body.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it("GET /:id returns one salary and 404s an unknown id", async () => {
    const created = (
      await api
        .post("/api/salaries")
        .send({ name: "Fetch Me", amount_cents: 7500, note: "one-off" })
        .expect(201)
    ).body;
    const fetched = await api.get(`/api/salaries/${created.id}`).expect(200);
    expect(fetched.body).toEqual(created);
    await api.get("/api/salaries/999999").expect(404);
    await api.get("/api/salaries/abc").expect(404);
  });

  it("PATCH updates name, amount, and note", async () => {
    const created = (
      await api
        .post("/api/salaries")
        .send({ name: "Old Name", amount_cents: 1000, note: "old" })
        .expect(201)
    ).body;
    const patched = await api
      .patch(`/api/salaries/${created.id}`)
      .send({ name: "New Name", amount_cents: 2500, note: "new" })
      .expect(200);
    expect(patched.body).toMatchObject({
      id: created.id,
      name: "New Name",
      amount_cents: 2500,
      note: "new",
      paid_at: created.paid_at,
    });
    await api
      .patch(`/api/salaries/${created.id}`)
      .send({ name: " " })
      .expect(400);
    await api.patch("/api/salaries/999999").send({ note: "x" }).expect(404);
  });

  it("DELETE removes the salary and 404s an unknown id", async () => {
    const doomed = (
      await api
        .post("/api/salaries")
        .send({ name: "Doomed", amount_cents: 100 })
        .expect(201)
    ).body;
    await api.delete(`/api/salaries/${doomed.id}`).expect(204);
    await api.get(`/api/salaries/${doomed.id}`).expect(404);
    await api.delete("/api/salaries/999999").expect(404);
  });

  it("rejects an empty name, bad amount, or non-string note", async () => {
    const bad = [
      {},
      { amount_cents: 100 },
      { name: "   ", amount_cents: 100 },
      { name: "X", amount_cents: -1 },
      { name: "X", amount_cents: 10.5 },
      { name: "X", amount_cents: "100" },
      { name: "X" },
      { name: "X", amount_cents: 100, note: 5 },
    ];
    for (const body of bad) {
      const res = await api.post("/api/salaries").send(body).expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }

    const created = (
      await api
        .post("/api/salaries")
        .send({ name: "Valid", amount_cents: 100 })
        .expect(201)
    ).body;
    for (const body of [
      { name: "" },
      { amount_cents: -5 },
      { amount_cents: 1.5 },
      { note: null },
    ]) {
      const res = await api
        .patch(`/api/salaries/${created.id}`)
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });
});
