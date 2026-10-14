import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-api-test-"));
const dbPath = join(dir, "api-test.db");
const app = createApp(dbPath);
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("menu round-trip", () => {
  it("POST category -> POST item -> GET menu_items contains it with correct price_cents", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Coffee RT", sort: 1 })
      .expect(201)
      .expect("Content-Type", /application\/json/);
    expect(cat.body.id).toEqual(expect.any(Number));
    expect(cat.body.name).toBe("Coffee RT");

    const item = await api
      .post("/api/menu_items")
      .send({
        category_id: cat.body.id,
        name: "Latte",
        price_cents: 12000,
        cost_cents: 4000,
      })
      .expect(201);
    expect(item.body.price_cents).toBe(12000);

    const list = await api.get("/api/menu_items").expect(200);
    const found = list.body.find((row) => row.id === item.body.id);
    expect(found).toMatchObject({ name: "Latte", price_cents: 12000 });
  });
});

describe("sales round-trip", () => {
  it("POST /api/sales computes total from DB prices, GET /:id returns items", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Tea" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Chai", price_cents: 8000 })
      .expect(201);

    // Attempt to smuggle a client-side total; server must ignore it.
    const sale = await api
      .post("/api/sales")
      .send({
        payment: "cash",
        total_cents: 1,
        items: [{ menu_item_id: item.body.id, qty: 2 }],
      })
      .expect(201);
    expect(sale.body.total_cents).toBe(16000);
    expect(sale.body.payment).toBe("cash");

    const fetched = await api
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
    const cat = await api
      .post("/api/categories")
      .send({ name: "Validation" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Mocha", price_cents: 9000 })
      .expect(201);

    const res = await api
      .post("/api/sales")
      .send({
        payment: "card",
        items: [{ menu_item_id: item.body.id, qty: 1 }],
      })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("unknown item -> 400 {error}", async () => {
    const res = await api
      .post("/api/sales")
      .send({ payment: "gcash", items: [{ menu_item_id: 999999, qty: 1 }] })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("empty items / bad qty -> 400 {error}", async () => {
    await api
      .post("/api/sales")
      .send({ payment: "cash", items: [] })
      .expect(400);
    await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: 1, qty: 0 }] })
      .expect(400);
  });

  it("inactive item -> 400 {error}", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Off-menu" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Retired", price_cents: 5000 })
      .expect(201);
    await api
      .patch(`/api/menu_items/${item.body.id}`)
      .send({ active: 0 })
      .expect(200);
    const res = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.body.id, qty: 1 }] })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });
});

describe("menu item constraint mapping", () => {
  it("duplicate POST / PATCH -> 400 {error}, never 500", async () => {
    // App-level pre-check (no schema UNIQUE): works on prod DBs as-is.
    const cat = await api
      .post("/api/categories")
      .send({ name: "Dupes" })
      .expect(201);
    await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Dupe Drink", price_cents: 5000 })
      .expect(201);

    const dup = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Dupe Drink", price_cents: 6000 })
      .expect(400);
    expect(dup.body.error).toEqual(expect.any(String));

    const other = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Other Drink", price_cents: 5000 })
      .expect(201);
    const clash = await api
      .patch(`/api/menu_items/${other.body.id}`)
      .send({ name: "Dupe Drink" })
      .expect(400);
    expect(clash.body.error).toEqual(expect.any(String));
  });
});

describe("sales void/edit + daily summary (Task 8)", () => {
  // Isolated DB so summary counts are exact (the shared DB above already
  // holds sales from earlier suites with server-generated timestamps).
  const dir2 = mkdtempSync(join(tmpdir(), "solace-task8-test-"));
  const app2 = createApp(join(dir2, "task8-test.db"));
  const api2 = authed(app2);
  afterAll(() => {
    app2.locals.db.close();
    rmSync(dir2, { recursive: true, force: true });
  });

  const today = () => new Date().toISOString().slice(0, 10);
  let itemA;
  let itemB;

  it("setup: category + two active items", async () => {
    const cat = await api2
      .post("/api/categories")
      .send({ name: "Task8" })
      .expect(201);
    itemA = (
      await api2
        .post("/api/menu_items")
        .send({ category_id: cat.body.id, name: "Drink A", price_cents: 8000 })
        .expect(201)
    ).body;
    itemB = (
      await api2
        .post("/api/menu_items")
        .send({ category_id: cat.body.id, name: "Drink B", price_cents: 5000 })
        .expect(201)
    ).body;
  });

  it("void excludes a sale from totals+count but keeps it in voided_count; unvoid restores", async () => {
    const cashSale = (
      await api2
        .post("/api/sales")
        .send({ payment: "cash", items: [{ menu_item_id: itemA.id, qty: 2 }] })
        .expect(201)
    ).body;
    expect(cashSale.total_cents).toBe(16000);
    await api2
      .post("/api/sales")
      .send({ payment: "gcash", items: [{ menu_item_id: itemB.id, qty: 1 }] })
      .expect(201);

    const before = await api2
      .get(`/api/sales/summary?date=${today()}`)
      .expect(200);
    expect(before.body).toMatchObject({
      date: today(),
      cash_total_cents: 16000,
      gcash_total_cents: 5000,
      sale_count: 2,
      voided_count: 0,
    });

    const voided = await api2
      .patch(`/api/sales/${cashSale.id}`)
      .send({ voided: 1 })
      .expect(200);
    expect(voided.body.voided).toBe(1);
    expect(voided.body.items).toHaveLength(1);

    const during = await api2
      .get(`/api/sales/summary?date=${today()}`)
      .expect(200);
    expect(during.body).toMatchObject({
      cash_total_cents: 0,
      gcash_total_cents: 5000,
      sale_count: 1,
      voided_count: 1,
    });

    const unvoided = await api2
      .patch(`/api/sales/${cashSale.id}`)
      .send({ voided: 0 })
      .expect(200);
    expect(unvoided.body.voided).toBe(0);

    const after = await api2
      .get(`/api/sales/summary?date=${today()}`)
      .expect(200);
    expect(after.body).toMatchObject({
      cash_total_cents: 16000,
      gcash_total_cents: 5000,
      sale_count: 2,
      voided_count: 0,
    });
  });

  it("PUT items replaces lines and recomputes the total (client total ignored)", async () => {
    const sale = (
      await api2
        .post("/api/sales")
        .send({ payment: "cash", items: [{ menu_item_id: itemA.id, qty: 1 }] })
        .expect(201)
    ).body;
    expect(sale.total_cents).toBe(8000);

    const updated = await api2
      .put(`/api/sales/${sale.id}/items`)
      .send({
        items: [{ menu_item_id: itemB.id, qty: 3 }],
        total_cents: 1,
      })
      .expect(200);
    expect(updated.body.total_cents).toBe(15000);
    expect(updated.body.items).toHaveLength(1);
    expect(updated.body.items[0]).toMatchObject({
      menu_item_id: itemB.id,
      qty: 3,
      unit_price_cents: 5000,
    });

    const fetched = await api2
      .get(`/api/sales/${sale.id}`)
      .expect(200);
    expect(fetched.body.total_cents).toBe(15000);
  });

  it("PUT on a voided sale -> 400 (unvoid first)", async () => {
    const sale = (
      await api2
        .post("/api/sales")
        .send({ payment: "gcash", items: [{ menu_item_id: itemA.id, qty: 1 }] })
        .expect(201)
    ).body;
    await api2
      .patch(`/api/sales/${sale.id}`)
      .send({ voided: 1 })
      .expect(200);
    const res = await api2
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: itemB.id, qty: 1 }] })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
    await api2
      .patch(`/api/sales/${sale.id}`)
      .send({ voided: 0 })
      .expect(200);
  });

  it("PUT rejects bad items: empty, bad qty, unknown/inactive item", async () => {
    const sale = (
      await api2
        .post("/api/sales")
        .send({ payment: "cash", items: [{ menu_item_id: itemA.id, qty: 1 }] })
        .expect(201)
    ).body;
    await api2
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [] })
      .expect(400);
    await api2
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: itemA.id, qty: 0 }] })
      .expect(400);
    await api2
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: 999999, qty: 1 }] })
      .expect(400);

    const retired = (
      await api2
        .post("/api/menu_items")
        .send({
          category_id: itemA.category_id,
          name: "Retired 8",
          price_cents: 5000,
        })
        .expect(201)
    ).body;
    await api2
      .patch(`/api/menu_items/${retired.id}`)
      .send({ active: 0 })
      .expect(200);
    await api2
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: retired.id, qty: 1 }] })
      .expect(400);
  });

  it("PATCH validates voided flag and ids", async () => {
    const sale = (
      await api2
        .post("/api/sales")
        .send({ payment: "cash", items: [{ menu_item_id: itemA.id, qty: 1 }] })
        .expect(201)
    ).body;
    await api2
      .patch(`/api/sales/${sale.id}`)
      .send({ voided: 5 })
      .expect(400);
    await api2
      .patch(`/api/sales/${sale.id}`)
      .send({})
      .expect(400);
    await api2.patch("/api/sales/999999").send({ voided: 1 }).expect(404);
    await api2.patch("/api/sales/abc").send({ voided: 1 }).expect(404);
    await api2
      .put("/api/sales/999999/items")
      .send({ items: [{ menu_item_id: itemA.id, qty: 1 }] })
      .expect(404);
  });

  it("summary filters by UTC date prefix; empty day is zeros; malformed date -> 400", async () => {
    app2.locals.db
      .prepare(
        "INSERT INTO sales (total_cents, payment, created_at) VALUES (?, ?, ?)",
      )
      .run(4200, "cash", "2000-01-05 10:00:00");

    const scoped = await api2
      .get("/api/sales/summary?date=2000-01-05")
      .expect(200);
    expect(scoped.body).toMatchObject({
      date: "2000-01-05",
      cash_total_cents: 4200,
      gcash_total_cents: 0,
      sale_count: 1,
      voided_count: 0,
    });

    const empty = await api2
      .get("/api/sales/summary?date=2000-01-06")
      .expect(200);
    expect(empty.body).toMatchObject({
      date: "2000-01-06",
      cash_total_cents: 0,
      gcash_total_cents: 0,
      sale_count: 0,
      voided_count: 0,
    });

    // The backdated sale must not leak into today's UTC-date summary.
    const current = await api2
      .get(`/api/sales/summary?date=${today()}`)
      .expect(200);
    expect(current.body.date).toBe(today());
    expect(current.body.cash_total_cents).not.toBe(4200);

    for (const bad of ["not-a-date", "2026-13-99", "2026-10-13T10:00", "13-10-2026"]) {
      const res = await api2
        .get(`/api/sales/summary?date=${bad}`)
        .expect(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it("summary defaults to today's UTC date and is not captured by /:id", async () => {
    const fallback = await api2.get("/api/sales/summary").expect(200);
    expect(fallback.body.date).toBe(today());
    expect(fallback.body).toHaveProperty("cash_total_cents");
    expect(fallback.body).toHaveProperty("gcash_total_cents");
    expect(fallback.body).toHaveProperty("sale_count");
    expect(fallback.body).toHaveProperty("voided_count");

    // parseId("summary") is null -> 404; proves /summary has its own route.
    const notId = await api2.get("/api/sales/summaryx").expect(404);
    expect(notId.body.error).toEqual(expect.any(String));
    const nonNumeric = await api2.get("/api/sales/abc").expect(404);
    expect(nonNumeric.body.error).toEqual(expect.any(String));
  });
});

describe("static frontend", () => {
  it("GET / returns HTML (or 503 JSON when dist is missing), never crashes", async () => {
    const res = await api.get("/");
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.text).toMatch(/<html/i);
    } else {
      expect(res.body.error).toEqual(expect.any(String));
    }
  });
});
