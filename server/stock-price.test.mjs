import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-stock-price-test-"));
const app = createApp(join(dir, "stock-price-test.db"));
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("stock_items price_cents (Task 7)", () => {
  it("old DB without the column opens with price 0 (boot migration)", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "solace-stock-price-legacy-"));
    const legacyPath = join(legacyDir, "legacy.db");
    try {
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE stock_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, low_threshold REAL NOT NULL DEFAULT 0)",
      );
      legacy
        .prepare(
          "INSERT INTO stock_items (name, unit, qty, low_threshold) VALUES (?, ?, ?, ?)",
        )
        .run("Old Beans", "g", 5, 2);
      legacy.close();

      const legacyApp = createApp(legacyPath);
      try {
        const cols = legacyApp.locals.db
          .prepare("PRAGMA table_info(stock_items)")
          .all()
          .map((col) => col.name);
        expect(cols).toContain("price_cents");
        const legacyApi = authed(legacyApp);
        const list = await legacyApi.get("/api/stock_items").expect(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0]).toMatchObject({
          name: "Old Beans",
          price_cents: 0,
        });
        const fetched = await legacyApi
          .get(`/api/stock_items/${list.body[0].id}`)
          .expect(200);
        expect(fetched.body.price_cents).toBe(0);
      } finally {
        legacyApp.locals.db.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("POST defaults price to 0 and round-trips an explicit price", async () => {
    const plain = (
      await api
        .post("/api/stock_items")
        .send({ name: "Priceless Salt", unit: "g" })
        .expect(201)
    ).body;
    expect(plain.price_cents).toBe(0);

    const priced = (
      await api
        .post("/api/stock_items")
        .send({ name: "Priced Beans", unit: "g", qty: 4, price_cents: 250 })
        .expect(201)
    ).body;
    expect(priced.price_cents).toBe(250);

    const fetched = await api
      .get(`/api/stock_items/${priced.id}`)
      .expect(200);
    expect(fetched.body).toMatchObject({
      name: "Priced Beans",
      price_cents: 250,
    });

    const list = await api.get("/api/stock_items").expect(200);
    expect(
      list.body.find((row) => row.id === priced.id),
    ).toMatchObject({ price_cents: 250 });
  });

  it("PATCH round-trips price and preserves it when omitted", async () => {
    const created = (
      await api
        .post("/api/stock_items")
        .send({ name: "Patch Beans", unit: "g", price_cents: 100 })
        .expect(201)
    ).body;
    const patched = await api
      .patch(`/api/stock_items/${created.id}`)
      .send({ price_cents: 375 })
      .expect(200);
    expect(patched.body.price_cents).toBe(375);

    const kept = await api
      .patch(`/api/stock_items/${created.id}`)
      .send({ qty: 9 })
      .expect(200);
    expect(kept.body).toMatchObject({ qty: 9, price_cents: 375 });
  });

  it("POST/PATCH reject negative and non-integer price with {error}", async () => {
    for (const body of [
      { name: "Neg Beans", unit: "g", price_cents: -1 },
      { name: "Float Beans", unit: "g", price_cents: 1.5 },
      { name: "String Beans", unit: "g", price_cents: "100" },
    ]) {
      const res = await api.post("/api/stock_items").send(body).expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    const created = (
      await api
        .post("/api/stock_items")
        .send({ name: "Strict Price Beans", unit: "g" })
        .expect(201)
    ).body;
    for (const body of [{ price_cents: -5 }, { price_cents: 2.5 }]) {
      const res = await api
        .patch(`/api/stock_items/${created.id}`)
        .send(body)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("seed-style INSERT without price still works (defaults to 0)", async () => {
    const info = app.locals.db
      .prepare(
        "INSERT INTO stock_items (name, unit, qty, low_threshold) VALUES (?, ?, 0, 0)",
      )
      .run("Seed Beans", "g");
    const fetched = await api
      .get(`/api/stock_items/${info.lastInsertRowid}`)
      .expect(200);
    expect(fetched.body.price_cents).toBe(0);
  });
});
