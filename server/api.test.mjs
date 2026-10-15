import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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

describe("daily order numbers", () => {
  // Isolated DB so the daily sequence starts at 1.
  const dir3 = mkdtempSync(join(tmpdir(), "solace-daily-seq-test-"));
  const app3 = createApp(join(dir3, "daily-seq-test.db"));
  const api3 = authed(app3);
  afterAll(() => {
    app3.locals.db.close();
    rmSync(dir3, { recursive: true, force: true });
  });

  it("POST assigns daily_seq 1,2 per UTC day", async () => {
    const cat = await api3
      .post("/api/categories")
      .send({ name: "DailySeq" })
      .expect(201);
    const item = (
      await api3
        .post("/api/menu_items")
        .send({ category_id: cat.body.id, name: "Seq Drink", price_cents: 5000 })
        .expect(201)
    ).body;
    const a = await api3
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
      .expect(201);
    const b = await api3
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
      .expect(201);
    expect(a.body.daily_seq).toBe(1);
    expect(b.body.daily_seq).toBe(2);
    const summary = await api3.get("/api/sales/summary").expect(200);
    expect(summary.body.next_order_number).toBe(3);
  });

  it("voided sales still consume numbers: summary and next POST agree", async () => {
    // Own isolated DB so the sequence is literally 1, 2, void, next = 3.
    const dir4 = mkdtempSync(join(tmpdir(), "solace-daily-seq-void-"));
    const app4 = createApp(join(dir4, "daily-seq-void.db"));
    const api4 = authed(app4);
    try {
      const cat = await api4
        .post("/api/categories")
        .send({ name: "DailySeqVoid" })
        .expect(201);
      const item = (
        await api4
          .post("/api/menu_items")
          .send({
            category_id: cat.body.id,
            name: "Void Drink",
            price_cents: 5000,
          })
          .expect(201)
      ).body;
      const s1 = (
        await api4
          .post("/api/sales")
          .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
          .expect(201)
      ).body;
      const s2 = (
        await api4
          .post("/api/sales")
          .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
          .expect(201)
      ).body;
      expect(s1.daily_seq).toBe(1);
      expect(s2.daily_seq).toBe(2);
      await api4.patch(`/api/sales/${s1.id}`).send({ voided: 1 }).expect(200);
      const during = await api4.get("/api/sales/summary").expect(200);
      expect(during.body.next_order_number).toBe(3);
      const s3 = (
        await api4
          .post("/api/sales")
          .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
          .expect(201)
      ).body;
      expect(s3.daily_seq).toBe(3);
    } finally {
      app4.locals.db.close();
      rmSync(dir4, { recursive: true, force: true });
    }
  });

  it("UTC day rollover resets daily_seq: prior-day rows never consume today's numbers", async () => {
    // Own isolated DB so today's sequence starts empty.
    const dirRoll = mkdtempSync(join(tmpdir(), "solace-daily-seq-roll-"));
    const appRoll = createApp(join(dirRoll, "daily-seq-roll.db"));
    const apiRoll = authed(appRoll);
    try {
      const cat = await apiRoll
        .post("/api/categories")
        .send({ name: "DailySeqRollover" })
        .expect(201);
      const item = (
        await apiRoll
          .post("/api/menu_items")
          .send({
            category_id: cat.body.id,
            name: "Rollover Drink",
            price_cents: 5000,
          })
          .expect(201)
      ).body;
      const oldDate = new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      appRoll.locals.db
        .prepare(
          "INSERT INTO sales (total_cents, payment, created_at) VALUES (?, ?, ?)",
        )
        .run(4200, "cash", `${oldDate} 10:00:00`);
      const posted = (
        await apiRoll
          .post("/api/sales")
          .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
          .expect(201)
      ).body;
      expect(posted.daily_seq).toBe(1);
      const current = await apiRoll
        .get(`/api/sales/summary?date=${today}`)
        .expect(200);
      expect(current.body.sale_count).toBe(1);
      expect(current.body.next_order_number).toBe(2);
      // The prior-day summary is unaffected by today's POST.
      const scoped = await apiRoll
        .get(`/api/sales/summary?date=${oldDate}`)
        .expect(200);
      expect(scoped.body).toMatchObject({
        date: oldDate,
        cash_total_cents: 4200,
        sale_count: 1,
        voided_count: 0,
        next_order_number: 2,
      });
    } finally {
      appRoll.locals.db.close();
      rmSync(dirRoll, { recursive: true, force: true });
    }
  });

  it("boot migration backfills dense per-day daily_seq for pre-existing rows", async () => {
    // Build an old-schema DB: sales table WITHOUT daily_seq (pre-feature),
    // two same-UTC-day rows plus one other-day row.
    const dirOld = mkdtempSync(join(tmpdir(), "solace-daily-seq-migrate-"));
    const oldDbPath = join(dirOld, "old-schema.db");
    const today = new Date().toISOString().slice(0, 10);
    const legacy = new Database(oldDbPath);
    try {
      legacy.exec(
        "CREATE TABLE sales (id INTEGER PRIMARY KEY, total_cents INTEGER NOT NULL, payment TEXT NOT NULL, voided INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
      );
      const add = legacy.prepare(
        "INSERT INTO sales (total_cents, payment, created_at) VALUES (?, ?, ?)",
      );
      add.run(5000, "cash", `${today} 10:00:00`);
      add.run(6000, "gcash", `${today} 11:00:00`);
      add.run(4200, "cash", "2000-01-05 10:00:00");
    } finally {
      legacy.close();
    }
    // Opening via createApp runs the boot migration (ALTER + backfill).
    const migrated = createApp(oldDbPath);
    const apiMigrated = authed(migrated);
    try {
      const todayRows = migrated.locals.db
        .prepare(
          "SELECT daily_seq FROM sales WHERE substr(created_at, 1, 10) = ? ORDER BY id",
        )
        .all(today);
      expect(todayRows.map((row) => row.daily_seq)).toEqual([1, 2]);
      const oldRows = migrated.locals.db
        .prepare(
          "SELECT daily_seq FROM sales WHERE substr(created_at, 1, 10) = ? ORDER BY id",
        )
        .all("2000-01-05");
      expect(oldRows.map((row) => row.daily_seq)).toEqual([1]);
      const summaryToday = await apiMigrated
        .get(`/api/sales/summary?date=${today}`)
        .expect(200);
      expect(summaryToday.body.sale_count).toBe(2);
      expect(summaryToday.body.next_order_number).toBe(3);
      const summaryOld = await apiMigrated
        .get("/api/sales/summary?date=2000-01-05")
        .expect(200);
      expect(summaryOld.body.next_order_number).toBe(2);
    } finally {
      migrated.locals.db.close();
      rmSync(dirOld, { recursive: true, force: true });
    }
  });
});

describe("sales paid flag (Task 5 regression)", () => {
  it("PATCH {paid} settles and unsettles; bad values and empty body -> 400", async () => {
    const dir5 = mkdtempSync(join(tmpdir(), "solace-paid-flag-test-"));
    const app5 = createApp(join(dir5, "paid-flag-test.db"));
    const api5 = authed(app5);
    try {
      const cat = await api5
        .post("/api/categories")
        .send({ name: "PaidFlag" })
        .expect(201);
      const item = (
        await api5
          .post("/api/menu_items")
          .send({
            category_id: cat.body.id,
            name: "Flag Drink",
            price_cents: 5000,
          })
          .expect(201)
      ).body;
      const created = (
        await api5
          .post("/api/sales")
          .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
          .expect(201)
      ).body;
      expect(created.paid).toBe(0);

      const settled = await api5
        .patch(`/api/sales/${created.id}`)
        .send({ paid: 1 })
        .expect(200);
      expect(settled.body.paid).toBe(1);

      const unsettled = await api5
        .patch(`/api/sales/${created.id}`)
        .send({ paid: 0 })
        .expect(200);
      expect(unsettled.body.paid).toBe(0);

      for (const bad of [{ paid: 5 }, { paid: "yes" }, {}]) {
        const res = await api5
          .patch(`/api/sales/${created.id}`)
          .send(bad)
          .expect(400);
        expect(res.body.error).toEqual(expect.any(String));
      }
    } finally {
      app5.locals.db.close();
      rmSync(dir5, { recursive: true, force: true });
    }
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

describe("menu item variants (Task 2)", () => {
  it("POST menu item with variants round-trips normalized options", async () => {
    const res = await api.post("/api/menu_items").send({ category_id: 1, name: "Ube Latte", price_cents: 7000, variants: ["Hot", " Iced ", "Hot"] });
    expect(res.status).toBe(201);
    expect(res.body.variants).toEqual(["Hot", "Iced"]);
  });

  // Isolated DB so variant history setup never leaks into other suites.
  const dirV = mkdtempSync(join(tmpdir(), "solace-variants-test-"));
  const appV = createApp(join(dirV, "variants-test.db"));
  const apiV = authed(appV);
  afterAll(() => {
    appV.locals.db.close();
    rmSync(dirV, { recursive: true, force: true });
  });

  it("POST with empty options saves []", async () => {
    const cat = await apiV
      .post("/api/categories")
      .send({ name: "Variants Empty" })
      .expect(201);
    const res = await apiV
      .post("/api/menu_items")
      .send({
        category_id: cat.body.id,
        name: "Plain Drink",
        price_cents: 5000,
        variants: ", , ",
      })
      .expect(201);
    expect(res.body.variants).toEqual([]);
  });

  it('POST with comma string "Fried, Steamed" saves ["Fried","Steamed"]', async () => {
    const cat = await apiV
      .post("/api/categories")
      .send({ name: "Variants Comma" })
      .expect(201);
    const res = await apiV
      .post("/api/menu_items")
      .send({
        category_id: cat.body.id,
        name: "Comma Item",
        price_cents: 5000,
        variants: "Fried, Steamed",
      })
      .expect(201);
    expect(res.body.variants).toEqual(["Fried", "Steamed"]);
  });

  it("PATCH removing a variant present in sale_items history returns 400 with history unchanged", async () => {
    const cat = await apiV
      .post("/api/categories")
      .send({ name: "Variants History" })
      .expect(201);
    const item = (
      await apiV
        .post("/api/menu_items")
        .send({
          category_id: cat.body.id,
          name: "History Siomai",
          price_cents: 5000,
          variants: ["Fried", "Steamed"],
        })
        .expect(201)
    ).body;
    const saleId = appV.locals.db
      .prepare(
        "INSERT INTO sales (total_cents, payment, created_at) VALUES (?, ?, ?)",
      )
      .run(5000, "cash", "2026-10-15 10:00:00").lastInsertRowid;
    appV.locals.db
      .prepare(
        "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents, variant) VALUES (?, ?, ?, ?, ?)",
      )
      .run(saleId, item.id, 1, 5000, "Fried");
    const res = await apiV
      .patch(`/api/menu_items/${item.id}`)
      .send({ variants: ["Steamed"] })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
    const history = appV.locals.db
      .prepare("SELECT variant FROM sale_items WHERE menu_item_id = ?")
      .all(item.id);
    expect(history.map((row) => row.variant)).toEqual(["Fried"]);
    const fetched = await apiV.get(`/api/menu_items/${item.id}`).expect(200);
    expect(fetched.body.variants).toEqual(["Fried", "Steamed"]);
  });

  it("GET list and GET by id return variants arrays (Siomai Fried/Steamed)", async () => {
    const list = await apiV.get("/api/menu_items").expect(200);
    const siomai = list.body.find((row) => row.name === "Siomai");
    expect(siomai).toBeDefined();
    expect(siomai.variants).toEqual(["Fried", "Steamed"]);
    const fetched = await apiV
      .get(`/api/menu_items/${siomai.id}`)
      .expect(200);
    expect(fetched.body.variants).toEqual(["Fried", "Steamed"]);
  });
});

describe("sale line variants (Task 3)", () => {
  async function foodSiomaiId() {
    const list = await api.get("/api/menu_items").expect(200);
    const siomai = list.body.find((row) => row.name === "Siomai");
    expect(siomai).toBeDefined();
    expect(siomai.price_cents).toBe(5000);
    expect(siomai.variants).toEqual(["Fried", "Steamed"]);
    return siomai.id;
  }

  async function plainItemId(name) {
    const cat = await api
      .post("/api/categories")
      .send({ name: `Task3 ${name}` })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name, price_cents: 5000 })
      .expect(201);
    expect(item.body.variants).toEqual([]);
    return item.body.id;
  }

  it("POST sale stores the chosen variant per line", async () => {
    const siomaiId = await foodSiomaiId();
    const res = await api.post("/api/sales").send({ payment: "cash", items: [{ menu_item_id: siomaiId, qty: 1, variant: "Fried" }] }).expect(201);
    expect(res.body.items[0].variant).toBe("Fried");
    const fetched = await api.get(`/api/sales/${res.body.id}`).expect(200);
    expect(fetched.body.items[0].variant).toBe("Fried");
  });

  it("POST sale with a variant for an item without variants returns 400", async () => {
    const plainId = await plainItemId("Plain Coffee");
    const res = await api
      .post("/api/sales")
      .send({
        payment: "cash",
        items: [{ menu_item_id: plainId, qty: 1, variant: "Hot" }],
      })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("POST sale with an unknown variant string returns 400", async () => {
    const siomaiId = await foodSiomaiId();
    const res = await api
      .post("/api/sales")
      .send({
        payment: "cash",
        items: [{ menu_item_id: siomaiId, qty: 1, variant: "Boiled" }],
      })
      .expect(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("POST sale with omitted variant stores NULL and returns null", async () => {
    const siomaiId = await foodSiomaiId();
    const res = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: siomaiId, qty: 1 }] })
      .expect(201);
    expect(res.body.items[0].variant).toBeNull();
    const fetched = await api.get(`/api/sales/${res.body.id}`).expect(200);
    expect(fetched.body.items[0].variant).toBeNull();
  });

  it("PUT /api/sales/:id/items preserves the same rules", async () => {
    const siomaiId = await foodSiomaiId();
    const plainId = await plainItemId("Plain Tea");
    const sale = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: siomaiId, qty: 1 }] })
      .expect(201);

    const valid = await api
      .put(`/api/sales/${sale.body.id}/items`)
      .send({ items: [{ menu_item_id: siomaiId, qty: 1, variant: "Steamed" }] })
      .expect(200);
    expect(valid.body.items[0].variant).toBe("Steamed");

    const unknown = await api
      .put(`/api/sales/${sale.body.id}/items`)
      .send({ items: [{ menu_item_id: siomaiId, qty: 1, variant: "Boiled" }] })
      .expect(400);
    expect(unknown.body.error).toEqual(expect.any(String));

    const noVariants = await api
      .put(`/api/sales/${sale.body.id}/items`)
      .send({ items: [{ menu_item_id: plainId, qty: 1, variant: "Hot" }] })
      .expect(400);
    expect(noVariants.body.error).toEqual(expect.any(String));

    const omitted = await api
      .put(`/api/sales/${sale.body.id}/items`)
      .send({ items: [{ menu_item_id: siomaiId, qty: 2 }] })
      .expect(200);
    expect(omitted.body.items[0].variant).toBeNull();
  });
});
