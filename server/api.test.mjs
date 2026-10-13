import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-api-test-"));
const dbPath = join(dir, "api-test.db");
const app = createApp(dbPath);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("menu round-trip", () => {
  it("POST category -> POST item -> GET menu_items contains it with correct price_cents", async () => {
    const cat = await request(app)
      .post("/api/categories")
      .send({ name: "Coffee", sort: 1 })
      .expect(201)
      .expect("Content-Type", /application\/json/);
    expect(cat.body.id).toEqual(expect.any(Number));
    expect(cat.body.name).toBe("Coffee");

    const item = await request(app)
      .post("/api/menu_items")
      .send({
        category_id: cat.body.id,
        name: "Latte",
        price_cents: 12000,
        cost_cents: 4000,
      })
      .expect(201);
    expect(item.body.price_cents).toBe(12000);

    const list = await request(app).get("/api/menu_items").expect(200);
    const found = list.body.find((row) => row.id === item.body.id);
    expect(found).toMatchObject({ name: "Latte", price_cents: 12000 });
  });
});

describe("sales round-trip", () => {
  it("POST /api/sales computes total from DB prices, GET /:id returns items", async () => {
    const cat = await request(app)
      .post("/api/categories")
      .send({ name: "Tea" })
      .expect(201);
    const item = await request(app)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Chai", price_cents: 8000 })
      .expect(201);

    // Attempt to smuggle a client-side total; server must ignore it.
    const sale = await request(app)
      .post("/api/sales")
      .send({
        payment: "cash",
        total_cents: 1,
        items: [{ menu_item_id: item.body.id, qty: 2 }],
      })
      .expect(201);
    expect(sale.body.total_cents).toBe(16000);
    expect(sale.body.payment).toBe("cash");

    const fetched = await request(app)
      .get(`/api/sales/${sale.body.id}`)
      .expect(200);
    expect(fetched.body.total_cents).toBe(16000);
    expect(fetched.body.items).toHaveLength(1);
    expect(fetched.body.items[0]).toMatchObject({
      menu_item_id: item.body.id,
      qty: 2,
      unit_price_cents: 8000,
    });
  });
});

describe("sales validation", () => {
  it("bad payment -> 400 {error}", async () => {
    const cat = await request(app)
      .post("/api/categories")
      .send({ name: "Validation" })
      .expect(201);
    const item = await request(app)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Mocha", price_cents: 9000 })
      .expect(201);

    const res = await request(app)
      .post("/api/sales")
      .send({
        payment: "card",
        items: [{ menu_item_id: item.body.id, qty: 1 }],
      })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("unknown item -> 400 {error}", async () => {
    const res = await request(app)
      .post("/api/sales")
      .send({ payment: "gcash", items: [{ menu_item_id: 999999, qty: 1 }] })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("empty items / bad qty -> 400 {error}", async () => {
    await request(app)
      .post("/api/sales")
      .send({ payment: "cash", items: [] })
      .expect(400);
    await request(app)
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: 1, qty: 0 }] })
      .expect(400);
  });

  it("inactive item -> 400 {error}", async () => {
    const cat = await request(app)
      .post("/api/categories")
      .send({ name: "Off-menu" })
      .expect(201);
    const item = await request(app)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Retired", price_cents: 5000 })
      .expect(201);
    await request(app)
      .patch(`/api/menu_items/${item.body.id}`)
      .send({ active: 0 })
      .expect(200);
    const res = await request(app)
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.body.id, qty: 1 }] })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });
});

describe("menu item constraint mapping", () => {
  it("duplicate POST / PATCH -> 400 {error}, never 500", async () => {
    // Schema ships no UNIQUE on menu_items; create one on this temp DB so
    // the SQLITE_CONSTRAINT->400 mapping in the handlers is exercised.
    app.locals.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_api_test_menu_items_unique_name ON menu_items (category_id, name)",
    );
    const cat = await request(app)
      .post("/api/categories")
      .send({ name: "Dupes" })
      .expect(201);
    await request(app)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Dupe Drink", price_cents: 5000 })
      .expect(201);

    const dup = await request(app)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Dupe Drink", price_cents: 6000 })
      .expect(400);
    expect(dup.body.error).toEqual(expect.any(String));

    const other = await request(app)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Other Drink", price_cents: 5000 })
      .expect(201);
    const clash = await request(app)
      .patch(`/api/menu_items/${other.body.id}`)
      .send({ name: "Dupe Drink" })
      .expect(400);
    expect(clash.body.error).toEqual(expect.any(String));
  });
});

describe("static frontend", () => {
  it("GET / returns HTML (or 503 JSON when dist is missing), never crashes", async () => {
    const res = await request(app).get("/");
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.text).toMatch(/<html/i);
    } else {
      expect(res.body.error).toEqual(expect.any(String));
    }
  });
});
