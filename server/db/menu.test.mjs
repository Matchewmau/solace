import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "../test-auth.mjs";
import { createApp } from "../app.mjs";
import { MENU } from "./menu-data.mjs";
import { seedDb } from "./seed.mjs";
import { seedMenu, seedMenuDb } from "./seed-menu.mjs";

// Binding source of truth: the exact 20 ACTIVE drink names + prices (cents).
const EXPECTED = new Map([
  ["Spanish Latte", 7000],
  ["Spanish Caramel Latte", 7000],
  ["French Vanilla Latte", 7000],
  ["Hazelnut Latte", 7000],
  ["Salted Caramel", 7000],
  ["Caramel Macchiato", 7000],
  ["Butterscotch Latte", 7000],
  ["Matcha Latte", 7000],
  ["Matcha Berry", 7000],
  ["Milky Mixed Berries", 8000],
  ["Milky Strawberry", 8000],
  ["Milky Blueberry", 8000],
  ["Milky Mango", 8000],
  ["Cookies & Cream", 8000],
  ["Milosaurus", 8000],
  ["Strawberry Soda", 5000],
  ["Blueberry Soda", 5000],
  ["Mango Soda", 5000],
  ["Green Apple Soda", 5000],
  ["Mixed Berries Soda", 5000],
]);

// Food seed: Siomai/Fries at 5000 with variants; Food has no guides.
const FOOD_EXPECTED = new Map([
  ["Siomai", { price_cents: 5000, variants: ["Fried", "Steamed"] }],
  ["Fries", { price_cents: 5000, variants: ["Cheese", "BBQ", "Sour Cream"] }],
]);

function foodRows(db) {
  return db
    .prepare(
      `SELECT m.name, m.price_cents, m.active, m.variants
         FROM menu_items m JOIN categories c ON c.id = m.category_id
         WHERE c.name = 'Food' ORDER BY m.name`,
    )
    .all();
}

const dir = mkdtempSync(join(tmpdir(), "solace-menu-test-"));
const dbPath = join(dir, "menu-test.db");

// Seed via the real seed-menu path (upsert, no wipe), twice for idempotency.
const first = seedMenu(dbPath);
const second = seedMenu(dbPath);
const app = createApp(dbPath);
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("menu seed data", () => {
  it("MENU module holds the binding 22 active items (20 drinks + Siomai/Fries) + inactive Dark Mocha", () => {
    const active = MENU.flatMap((g) =>
      g.items.filter((i) => (i.active ?? 1) === 1),
    );
    expect(active).toHaveLength(22);
    for (const [name, price] of EXPECTED) {
      const found = active.find((i) => i.name === name);
      expect(found, `missing ${name}`).toBeDefined();
      expect(found.price_cents).toBe(price);
    }
    for (const [name, want] of FOOD_EXPECTED) {
      const found = active.find((i) => i.name === name);
      expect(found, `missing ${name}`).toBeDefined();
      expect(found.price_cents).toBe(want.price_cents);
      expect(found.variants).toEqual(want.variants);
    }
    const dark = MENU.flatMap((g) => g.items).find(
      (i) => i.name === "Dark Mocha",
    );
    expect(dark).toBeDefined();
    expect(dark.active).toBe(0);
  });

  it("seedMenu reports per-category counts + total active 22", () => {
    expect(first.totalActive).toBe(22);
    expect(second.totalActive).toBe(22);
    expect(first.counts).toEqual(second.counts);
  });

  it("re-running seed-menu creates no dupes", async () => {
    const all = await api.get("/api/menu_items").expect(200);
    const names = all.body.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("GET /api/menu_items?active=1 returns exactly the 22 names+prices", async () => {
    const res = await api.get("/api/menu_items?active=1").expect(200);
    expect(res.body).toHaveLength(22);
    const got = new Map(res.body.map((r) => [r.name, r.price_cents]));
    for (const [name, price] of EXPECTED) {
      expect(got.get(name), `price for ${name}`).toBe(price);
    }
    for (const [name, want] of FOOD_EXPECTED) {
      expect(got.get(name), `price for ${name}`).toBe(want.price_cents);
    }
    for (const row of res.body) {
      expect(row.cost_cents).toBe(0);
    }
  });

  it("Dark Mocha exists but is inactive", async () => {
    const res = await api.get("/api/menu_items?active=0").expect(200);
    const dark = res.body.find((r) => r.name === "Dark Mocha");
    expect(dark).toBeDefined();
    expect(dark.active).toBe(0);
  });

  it("seeds Food last with Siomai and Fries variants at 5000", async () => {
    const { counts } = seedMenuDb(app.locals.db);
    expect(counts["Food"].total).toBe(2);

    const cats = await api.get("/api/categories").expect(200);
    const food = cats.body.find((c) => c.name === "Food");
    expect(food, "Food category exists").toBeDefined();
    const maxSort = Math.max(...cats.body.map((c) => c.sort));
    expect(food.sort, "Food sorts last").toBe(maxSort);

    const byName = new Map(foodRows(app.locals.db).map((r) => [r.name, r]));
    expect([...byName.keys()].sort()).toEqual(["Fries", "Siomai"]);
    for (const [name, want] of FOOD_EXPECTED) {
      const row = byName.get(name);
      expect(row, `missing ${name}`).toBeDefined();
      expect(row.price_cents).toBe(want.price_cents);
      expect(row.active).toBe(1);
      expect(JSON.parse(row.variants)).toEqual(want.variants);
    }

    // Re-run is idempotent: no dupes, variants backfilled, Dark Mocha untouched.
    seedMenu(dbPath);
    const rerun = foodRows(app.locals.db);
    expect(rerun).toHaveLength(2);
    for (const [name, want] of FOOD_EXPECTED) {
      const row = rerun.find((r) => r.name === name);
      expect(JSON.parse(row.variants)).toEqual(want.variants);
      expect(row.price_cents).toBe(want.price_cents);
    }
    const inactive = await api.get("/api/menu_items?active=0").expect(200);
    const dark = inactive.body.find((r) => r.name === "Dark Mocha");
    expect(dark, "Dark Mocha stays inactive").toBeDefined();
  });

  it("seed.mjs smoke chain: 22 MENU names+prices exact, foreign row preserved, Dark Mocha inactive", async () => {
    // Controller ruling: seed.mjs smoke fixtures are dev-only scaffolding,
    // excluded from the "22 items" acceptance; seed-menu must preserve them.
    const chainDbPath = join(dir, "menu-chain-test.db");
    seedDb(chainDbPath).close();
    const result = seedMenu(chainDbPath);
    expect(result.totalActive).toBe(23); // 22 MENU + preserved Smoke Drink
    const chainApp = createApp(chainDbPath);
    const chainApi = authed(chainApp);
    try {
      const res = await chainApi
        .get("/api/menu_items?active=1")
        .expect(200);
      const got = new Map(res.body.map((r) => [r.name, r.price_cents]));
      for (const [name, price] of EXPECTED) {
        expect(got.get(name), `price for ${name}`).toBe(price);
      }
      const smoke = res.body.find((r) => r.name === "Smoke Drink");
      expect(smoke, "smoke fixture preserved").toBeDefined();
      expect(smoke.active).toBe(1);
      const inactive = await chainApi
        .get("/api/menu_items?active=0")
        .expect(200);
      const dark = inactive.body.find((r) => r.name === "Dark Mocha");
      expect(dark).toBeDefined();
      expect(dark.active).toBe(0);
    } finally {
      chainApp.locals.db.close();
    }
  });
});

describe("admin CRUD proof on real menu data", () => {
  it("POST seasonal -> PATCH price -> PATCH active toggle -> DELETE", async () => {
    const cats = await api.get("/api/categories").expect(200);
    const coffee = cats.body.find((c) => c.name === "Coffee");
    expect(coffee).toBeDefined();

    const created = await api
      .post("/api/menu_items")
      .send({
        category_id: coffee.id,
        name: "Seasonal Test Ube Latte",
        price_cents: 7500,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      name: "Seasonal Test Ube Latte",
      price_cents: 7500,
      active: 1,
    });

    const repatched = await api
      .patch(`/api/menu_items/${created.body.id}`)
      .send({ price_cents: 8000 })
      .expect(200);
    expect(repatched.body.price_cents).toBe(8000);

    const deactivated = await api
      .patch(`/api/menu_items/${created.body.id}`)
      .send({ active: 0 })
      .expect(200);
    expect(deactivated.body.active).toBe(0);

    await api.delete(`/api/menu_items/${created.body.id}`).expect(204);
    await api.get(`/api/menu_items/${created.body.id}`).expect(404);
  });

  it("re-run applies price corrections, preserves flags, keeps sales, forces Dark Mocha inactive", async () => {
    const list = await api.get("/api/menu_items?active=1").expect(200);
    const mango = list.body.find((r) => r.name === "Mango Soda");
    const matcha = list.body.find((r) => r.name === "Matcha Latte");
    // Operator reprices + deactivates; sale booked before the re-run.
    await api
      .patch(`/api/menu_items/${mango.id}`)
      .send({ active: 0, price_cents: 9999 })
      .expect(200);
    const sale = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: matcha.id, qty: 1 }] })
      .expect(201);
    expect(sale.body.total_cents).toBe(7000);
    const all = await api.get("/api/menu_items").expect(200);
    const dark = all.body.find((r) => r.name === "Dark Mocha");
    await api
      .patch(`/api/menu_items/${dark.id}`)
      .send({ active: 1 })
      .expect(200);

    seedMenu(dbPath);

    const mangoAfter = await api
      .get(`/api/menu_items/${mango.id}`)
      .expect(200);
    expect(mangoAfter.body.price_cents).toBe(5000);
    expect(mangoAfter.body.active).toBe(0);
    const darkAfter = await api
      .get(`/api/menu_items/${dark.id}`)
      .expect(200);
    expect(darkAfter.body.active).toBe(0);
    const saleAfter = await api
      .get(`/api/sales/${sale.body.id}`)
      .expect(200);
    expect(saleAfter.body.total_cents).toBe(7000);
    // Restore shared state.
    await api
      .patch(`/api/menu_items/${mango.id}`)
      .send({ active: 1 })
      .expect(200);
  });
});
