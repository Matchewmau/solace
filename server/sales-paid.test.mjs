import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-sales-paid-test-"));
const app = createApp(join(dir, "sales-paid-test.db"));
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("sales paid flag", () => {
  it("old DB without the column opens via createApp with paid 0 (boot migration)", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "solace-sales-paid-legacy-"));
    const legacyPath = join(legacyDir, "legacy.db");
    try {
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE sales (id INTEGER PRIMARY KEY, total_cents INTEGER NOT NULL, payment TEXT NOT NULL CHECK (payment IN ('cash', 'gcash')), voided INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
      );
      legacy
        .prepare(
          "INSERT INTO sales (total_cents, payment, voided, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(5000, "cash", 0, "2026-01-05 10:00:00");
      legacy.close();

      const legacyApp = createApp(legacyPath);
      try {
        const cols = legacyApp.locals.db
          .prepare("PRAGMA table_info(sales)")
          .all()
          .map((col) => col.name);
        expect(cols).toContain("paid");
        const legacyApi = authed(legacyApp);
        const list = await legacyApi.get("/api/sales").expect(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0]).toMatchObject({ total_cents: 5000, paid: 0 });
        const fetched = await legacyApi
          .get(`/api/sales/${list.body[0].id}`)
          .expect(200);
        expect(fetched.body.paid).toBe(0);
      } finally {
        legacyApp.locals.db.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("POST /api/sales defaults paid 0 and round-trips paid 1", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Paid POST" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Paid Drink", price_cents: 8000 })
      .expect(201);

    const plain = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.body.id, qty: 1 }],
        })
        .expect(201)
    ).body;
    expect(plain.paid).toBe(0);

    const paidSale = (
      await api
        .post("/api/sales")
        .send({
          payment: "gcash",
          paid: 1,
          items: [{ menu_item_id: item.body.id, qty: 2 }],
        })
        .expect(201)
    ).body;
    expect(paidSale.paid).toBe(1);
    expect(paidSale.total_cents).toBe(16000);

    const fetched = await api.get(`/api/sales/${paidSale.id}`).expect(200);
    expect(fetched.body.paid).toBe(1);

    const list = await api.get("/api/sales").expect(200);
    expect(list.body.find((row) => row.id === paidSale.id)).toMatchObject({
      paid: 1,
    });
  });

  it("PATCH /api/sales/:id toggles paid 0/1 (and still toggles voided as before)", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Paid PATCH" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Patch Drink", price_cents: 5000 })
      .expect(201);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.body.id, qty: 1 }],
        })
        .expect(201)
    ).body;
    expect(sale.paid).toBe(0);

    const marked = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(marked.body.paid).toBe(1);
    expect(marked.body.voided).toBe(0);

    const unmarked = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 0 })
      .expect(200);
    expect(unmarked.body.paid).toBe(0);

    const voided = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ voided: 1 })
      .expect(200);
    expect(voided.body.voided).toBe(1);
    expect(voided.body.paid).toBe(0);

    const restored = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ voided: 0 })
      .expect(200);
    expect(restored.body.voided).toBe(0);
  });

  it("POST/PATCH reject paid 2 with 400 {error}", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Paid Reject" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Reject Drink", price_cents: 5000 })
      .expect(201);

    const badPost = await api
      .post("/api/sales")
      .send({
        payment: "cash",
        paid: 2,
        items: [{ menu_item_id: item.body.id, qty: 1 }],
      })
      .expect(400);
    expect(badPost.body.error).toEqual(expect.any(String));

    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.body.id, qty: 1 }],
        })
        .expect(201)
    ).body;
    const badPatch = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 2 })
      .expect(400);
    expect(badPatch.body.error).toEqual(expect.any(String));
  });
});
