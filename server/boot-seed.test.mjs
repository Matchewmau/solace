// Boot auto-seed: fresh DBs gain the 20-drink menu + recipes on createApp;
// reopening adds no dupes and never touches sales. Stock is NOT auto-seeded.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-boot-seed-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function counts(db) {
  return {
    menu: db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n,
    active: db.prepare("SELECT COUNT(*) AS n FROM menu_items WHERE active = 1").get().n,
    recipes: db.prepare("SELECT COUNT(*) AS n FROM recipes").get().n,
    lines: db.prepare("SELECT COUNT(*) AS n FROM recipe_lines").get().n,
    stock: db.prepare("SELECT COUNT(*) AS n FROM stock_items").get().n,
  };
}

describe("boot auto-seed", () => {
  it("fresh DB boots with 20 active drinks (21 rows) + 21 recipes, no stock", async () => {
    const dbPath = join(dir, "fresh.db");
    const app = createApp(dbPath);
    try {
      const api = authed(app);
      const active = await api.get("/api/menu_items?active=1").expect(200);
      expect(active.body).toHaveLength(20);
      const all = await api.get("/api/menu_items").expect(200);
      expect(all.body).toHaveLength(21);
      const dark = all.body.find((r) => r.name === "Dark Mocha");
      expect(dark).toBeDefined();
      expect(dark.active).toBe(0);
      const recipes = await api.get("/api/recipes").expect(200);
      expect(recipes.body).toHaveLength(21);
      expect(counts(app.locals.db).stock).toBe(0);
    } finally {
      app.locals.db.close();
    }
  });

  it("reopen adds no dupes", async () => {
    const dbPath = join(dir, "reopen.db");
    const first = createApp(dbPath);
    const before = counts(first.locals.db);
    expect(before.menu).toBe(21);
    expect(before.recipes).toBe(21);
    first.locals.db.close();

    const second = createApp(dbPath);
    try {
      const after = counts(second.locals.db);
      expect(after).toEqual(before);
      const api = authed(second);
      const all = await api.get("/api/menu_items").expect(200);
      const names = all.body.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    } finally {
      second.locals.db.close();
    }
  });

  it("sales DB untouched: sale + totals survive reboot with no dupes", async () => {
    const dbPath = join(dir, "sales.db");
    const app = createApp(dbPath);
    const api = authed(app);
    const menu = await api.get("/api/menu_items?active=1").expect(200);
    const item = menu.body.find((r) => r.name === "Matcha Latte");
    expect(item).toBeDefined();
    const sale = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
      .expect(201);
    expect(sale.body.total_cents).toBe(7000);
    const before = counts(app.locals.db);
    app.locals.db.close();

    const reopened = createApp(dbPath);
    try {
      expect(counts(reopened.locals.db)).toEqual(before);
      const reopenedApi = authed(reopened);
      const fetched = await reopenedApi.get(`/api/sales/${sale.body.id}`).expect(200);
      expect(fetched.body.total_cents).toBe(7000);
      const summary = await reopenedApi.get("/api/sales/summary").expect(200);
      expect(summary.body.sale_count).toBe(1);
    } finally {
      reopened.locals.db.close();
    }
  });
});
