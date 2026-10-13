import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.mjs";
import { seedMenu } from "./db/seed-menu.mjs";
import { seedRecipes } from "./db/seed-recipes.mjs";
import { seedStock } from "./db/seed-stock.mjs";
import { RECIPES } from "./db/recipe-data.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-stock-api-test-"));
const app = createApp(join(dir, "stock-api-test.db"));

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("stock_items CRUD (Task 10)", () => {
  it("POST creates with defaults (qty 0, low_threshold 0) -> 201", async () => {
    const res = await request(app)
      .post("/api/stock_items")
      .send({ name: "Milk", unit: "ml" })
      .expect(201);
    expect(res.body).toMatchObject({
      name: "Milk",
      unit: "ml",
      qty: 0,
      low_threshold: 0,
    });
    expect(res.body.id).toEqual(expect.any(Number));
  });

  it("POST validates: missing name, non-string unit, negative qty/threshold -> 400", async () => {
    await request(app)
      .post("/api/stock_items")
      .send({ unit: "ml" })
      .expect(400);
    await request(app)
      .post("/api/stock_items")
      .send({ name: "  ", unit: "ml" })
      .expect(400);
    await request(app)
      .post("/api/stock_items")
      .send({ name: "Sugar", unit: 5 })
      .expect(400);
    await request(app)
      .post("/api/stock_items")
      .send({ name: "Sugar", unit: "g", qty: -1 })
      .expect(400);
    await request(app)
      .post("/api/stock_items")
      .send({ name: "Sugar", unit: "g", low_threshold: -2 })
      .expect(400);
    for (const res of [
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Sugar", unit: "g", qty: "10" }),
    ]) {
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("GET list contains created rows; GET :id round-trips; unknown -> 404", async () => {
    const created = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Coffee", unit: "ml", qty: 120, low_threshold: 50 })
        .expect(201)
    ).body;
    const list = await request(app).get("/api/stock_items").expect(200);
    expect(list.body.find((row) => row.id === created.id)).toMatchObject({
      name: "Coffee",
      qty: 120,
      low_threshold: 50,
    });
    const fetched = await request(app)
      .get(`/api/stock_items/${created.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({ name: "Coffee", unit: "ml" });
    await request(app).get("/api/stock_items/999999").expect(404);
    await request(app).get("/api/stock_items/abc").expect(404);
  });

  it("PATCH sets any subset and preserves the rest; bad values -> 400", async () => {
    const created = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Sprite", unit: "btl", qty: 10, low_threshold: 4 })
        .expect(201)
    ).body;
    const patched = await request(app)
      .patch(`/api/stock_items/${created.id}`)
      .send({ low_threshold: 6 })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: "Sprite",
      unit: "btl",
      qty: 10,
      low_threshold: 6,
    });
    await request(app)
      .patch(`/api/stock_items/${created.id}`)
      .send({ qty: -1 })
      .expect(400);
    await request(app)
      .patch(`/api/stock_items/${created.id}`)
      .send({ name: "" })
      .expect(400);
    await request(app)
      .patch("/api/stock_items/999999")
      .send({ qty: 1 })
      .expect(404);
  });

  it("DELETE -> 204, then GET -> 404; unknown -> 404; item with movements -> 400", async () => {
    const doomed = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Doomed Beans", unit: "g", qty: 5 })
        .expect(201)
    ).body;
    await request(app).delete(`/api/stock_items/${doomed.id}`).expect(204);
    await request(app).get(`/api/stock_items/${doomed.id}`).expect(404);
    await request(app).delete("/api/stock_items/999999").expect(404);

    const ledgered = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Ledgered Beans", unit: "g", qty: 5 })
        .expect(201)
    ).body;
    await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: ledgered.id, delta: 5, reason: "delivery" })
      .expect(201);
    const blocked = await request(app)
      .delete(`/api/stock_items/${ledgered.id}`)
      .expect(400);
    expect(blocked.body.error).toEqual(expect.any(String));
  });
});

describe("stock_movements ledger (Task 10)", () => {
  it("delivery applies its delta to qty in the same call", async () => {
    const item = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Ledger Milk", unit: "ml" })
        .expect(201)
    ).body;
    const movement = await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: item.id, delta: 50, reason: "delivery" })
      .expect(201);
    expect(movement.body).toMatchObject({
      stock_item_id: item.id,
      delta: 50,
      reason: "delivery",
    });
    const after = await request(app)
      .get(`/api/stock_items/${item.id}`)
      .expect(200);
    expect(after.body.qty).toBe(50);
  });

  it("waste subtracts; set-count posts adjustment delta = newCount - currentQty", async () => {
    const item = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Count Milk", unit: "ml" })
        .expect(201)
    ).body;
    await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: item.id, delta: 50, reason: "delivery" })
      .expect(201);
    await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: item.id, delta: -5, reason: "waste" })
      .expect(201);
    const mid = await request(app)
      .get(`/api/stock_items/${item.id}`)
      .expect(200);
    expect(mid.body.qty).toBe(45);

    // Set-count rule: the client computes delta = newCount - currentQty.
    const currentQty = mid.body.qty;
    const newCount = 100;
    const setCount = await request(app)
      .post("/api/stock_movements")
      .send({
        stock_item_id: item.id,
        delta: newCount - currentQty,
        reason: "adjustment",
      })
      .expect(201);
    expect(setCount.body.delta).toBe(55);
    const after = await request(app)
      .get(`/api/stock_items/${item.id}`)
      .expect(200);
    expect(after.body.qty).toBe(100);
  });

  it("movement that would make qty negative -> 400 and qty unchanged", async () => {
    const item = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Thin Stock", unit: "ml", qty: 3 })
        .expect(201)
    ).body;
    const res = await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: item.id, delta: -5, reason: "waste" })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
    const after = await request(app)
      .get(`/api/stock_items/${item.id}`)
      .expect(200);
    expect(after.body.qty).toBe(3);
  });

  it("bad reason -> 400; zero/non-numeric delta -> 400; bad id -> 400; unknown item -> 404", async () => {
    const item = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Strict Stock", unit: "ml", qty: 10 })
        .expect(201)
    ).body;
    for (const body of [
      { stock_item_id: item.id, delta: 5, reason: "sale" },
      { stock_item_id: item.id, delta: 5, reason: "" },
      { stock_item_id: item.id, delta: 5 },
      { stock_item_id: item.id, delta: 0, reason: "adjustment" },
      { stock_item_id: item.id, delta: "5", reason: "delivery" },
      { stock_item_id: item.id, delta: Number.NaN, reason: "delivery" },
      { delta: 5, reason: "delivery" },
      { stock_item_id: "abc", delta: 5, reason: "delivery" },
    ]) {
      const res = await request(app)
        .post("/api/stock_movements")
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    const missing = await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: 999999, delta: 5, reason: "delivery" })
      .expect(404);
    expect(missing.body.error).toEqual(expect.any(String));
  });

  it("GET filters by stock_item_id and returns latest-first; all when absent", async () => {
    const itemA = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Filter A", unit: "ml", qty: 100 })
        .expect(201)
    ).body;
    const itemB = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Filter B", unit: "ml", qty: 100 })
        .expect(201)
    ).body;
    await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: itemA.id, delta: 10, reason: "delivery" })
      .expect(201);
    await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: itemA.id, delta: -2, reason: "waste" })
      .expect(201);
    await request(app)
      .post("/api/stock_movements")
      .send({ stock_item_id: itemB.id, delta: 7, reason: "delivery" })
      .expect(201);

    const filtered = await request(app)
      .get(`/api/stock_movements?stock_item_id=${itemA.id}`)
      .expect(200);
    expect(filtered.body).toHaveLength(2);
    expect(filtered.body.map((m) => m.delta)).toEqual([-2, 10]);
    for (const m of filtered.body) {
      expect(m.stock_item_id).toBe(itemA.id);
    }
    const all = await request(app).get("/api/stock_movements").expect(200);
    expect(all.body.length).toBeGreaterThanOrEqual(3);
    const bad = await request(app)
      .get("/api/stock_movements?stock_item_id=abc")
      .expect(400);
    expect(bad.body.error).toEqual(expect.any(String));
  });

  it("?low=1 flags qty == threshold (boundary) and below, not above", async () => {
    const boundary = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Low Boundary", unit: "ml", qty: 5, low_threshold: 5 })
        .expect(201)
    ).body;
    const below = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Low Below", unit: "ml", qty: 2, low_threshold: 5 })
        .expect(201)
    ).body;
    const above = (
      await request(app)
        .post("/api/stock_items")
        .send({ name: "Low Above", unit: "ml", qty: 6, low_threshold: 5 })
        .expect(201)
    ).body;
    const low = await request(app).get("/api/stock_items?low=1").expect(200);
    const ids = low.body.map((row) => row.id);
    expect(ids).toContain(boundary.id);
    expect(ids).toContain(below.id);
    expect(ids).not.toContain(above.id);
  });
});

describe("seed-stock idempotent (Task 10)", () => {
  const dir2 = mkdtempSync(join(tmpdir(), "solace-seed-stock-test-"));
  const dbPath2 = join(dir2, "seed-stock-test.db");
  seedMenu(dbPath2);
  seedRecipes(dbPath2);
  afterAll(() => {
    rmSync(dir2, { recursive: true, force: true });
  });

  it("creates one row per DISTINCT recipe pair (Ice with empty unit), then skips all on re-run", () => {
    const expected = new Set(
      RECIPES.flatMap((recipe) =>
        recipe.lines.map((line) => `${line.ingredient} ${line.unit ?? ""}`),
      ),
    ).size;

    const first = seedStock(dbPath2);
    expect(first).toEqual({ created: expected, skipped: 0 });

    const db = new Database(dbPath2);
    try {
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM stock_items")
        .get().n;
      expect(count).toBe(expected);
      const ice = db
        .prepare("SELECT id, name, unit, qty FROM stock_items WHERE name = ?")
        .get("Ice");
      expect(ice).toMatchObject({ name: "Ice", unit: "", qty: 0 });
    } finally {
      db.close();
    }

    const second = seedStock(dbPath2);
    expect(second).toEqual({ created: 0, skipped: expected });
  });
});
