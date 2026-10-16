// Fix 1: legacy DBs (non-empty menu, no Food category) gain the Food menu
// once via a targeted bootstrap on createApp — without re-running the full
// seed — and owner edits survive every later boot. Fresh DBs keep the
// existing full-seed behavior.
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-boot-food-seed-"));

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can hold the temp DB locked if a run is aborted; cleanup
    // must not add a second failure that masks the real one.
  }
});

// Pre-variant (guide-menu Task 1) table shapes: menu_items lacks the
// variants column and sale_items lacks the variant column; everything else
// matches a customer DB that ran the earlier boot migrations.
function buildLegacyDb(dbPath) {
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE menu_items (
      id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY,
      total_cents INTEGER NOT NULL,
      payment TEXT NOT NULL CHECK (payment IN ('cash', 'gcash')),
      voided INTEGER NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      daily_seq INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id),
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      qty INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL
    );
    CREATE TABLE recipes (
      id INTEGER PRIMARY KEY,
      menu_item_id INTEGER NOT NULL UNIQUE REFERENCES menu_items(id),
      steps TEXT NOT NULL
    );
    CREATE TABLE recipe_lines (
      id INTEGER PRIMARY KEY,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id),
      ingredient TEXT NOT NULL,
      qty REAL,
      unit TEXT
    );
  `);
  const addCategory = legacy.prepare(
    "INSERT INTO categories (name, sort) VALUES (?, ?)",
  );
  const coffee = addCategory.run("Legacy Coffee", 1).lastInsertRowid;
  const tea = addCategory.run("Legacy Tea", 5).lastInsertRowid;
  const addItem = legacy.prepare(
    "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active) VALUES (?, ?, ?, 0, ?)",
  );
  const latte = addItem.run(coffee, "Legacy Latte", 6500, 1).lastInsertRowid;
  addItem.run(coffee, "Legacy Mocha", 7000, 0);
  addItem.run(tea, "Legacy Milk Tea", 5500, 1);
  const sale = legacy
    .prepare(
      "INSERT INTO sales (total_cents, payment, voided, created_at) VALUES (?, ?, 0, ?)",
    )
    .run(6500, "cash", "2026-01-05 10:00:00").lastInsertRowid;
  legacy
    .prepare(
      "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents) VALUES (?, ?, ?, ?)",
    )
    .run(sale, latte, 1, 6500);
  const recipe = legacy
    .prepare("INSERT INTO recipes (menu_item_id, steps) VALUES (?, ?)")
    .run(latte, "1. Brew\n2. Serve").lastInsertRowid;
  legacy
    .prepare(
      "INSERT INTO recipe_lines (recipe_id, ingredient, qty, unit) VALUES (?, ?, ?, ?)",
    )
    .run(recipe, "Legacy Beans", 18, "g");
  legacy.close();
}

// Legacy-DB build + boot + HTTP round trips is heavy; the default 5s
// test timeout flakes under machine load.
describe("boot Food bootstrap on legacy databases (Fix 1)", { timeout: 15000 }, () => {
  it("legacy DB gains only Food (Siomai/Fries) and keeps items, sale, recipe", async () => {
    const dbPath = join(dir, "legacy.db");
    buildLegacyDb(dbPath);

    const app = createApp(dbPath);
    try {
      const db = app.locals.db;

      // Variant boot migrations still run.
      const menuCols = db
        .prepare("PRAGMA table_info(menu_items)")
        .all()
        .map((col) => col.name);
      expect(menuCols).toContain("variants");
      const saleItemCols = db
        .prepare("PRAGMA table_info(sale_items)")
        .all()
        .map((col) => col.name);
      expect(saleItemCols).toContain("variant");

      // Food lands once, after any foreign/operator categories (max + 1).
      const cats = db
        .prepare("SELECT name, sort FROM categories ORDER BY id")
        .all();
      expect(cats).toEqual([
        { name: "Legacy Coffee", sort: 1 },
        { name: "Legacy Tea", sort: 5 },
        { name: "Food", sort: 6 },
      ]);

      const food = db
        .prepare("SELECT id FROM categories WHERE name = 'Food'")
        .get();
      const foodItems = db
        .prepare(
          "SELECT name, price_cents, active, variants FROM menu_items WHERE category_id = ? ORDER BY id",
        )
        .all(food.id);
      expect(foodItems).toEqual([
        {
          name: "Siomai",
          price_cents: 5000,
          active: 1,
          variants: '["Fried","Steamed"]',
        },
        {
          name: "Fries",
          price_cents: 5000,
          active: 1,
          variants: '["Cheese","BBQ","Sour Cream"]',
        },
      ]);

      // Existing items untouched: price, inactive flag and '[]' backfill.
      expect(
        db
          .prepare(
            "SELECT price_cents, active, variants FROM menu_items WHERE name = 'Legacy Latte'",
          )
          .get(),
      ).toEqual({ price_cents: 6500, active: 1, variants: "[]" });
      expect(
        db
          .prepare(
            "SELECT price_cents, active, variants FROM menu_items WHERE name = 'Legacy Mocha'",
          )
          .get(),
      ).toEqual({ price_cents: 7000, active: 0, variants: "[]" });
      expect(
        db
          .prepare(
            "SELECT price_cents, active FROM menu_items WHERE name = 'Legacy Milk Tea'",
          )
          .get(),
      ).toEqual({ price_cents: 5500, active: 1 });

      // Sale, its line and the recipe survive the boot.
      expect(db.prepare("SELECT total_cents FROM sales").all()).toEqual([
        { total_cents: 6500 },
      ]);
      expect(
        db
          .prepare("SELECT qty, unit_price_cents, variant FROM sale_items")
          .all(),
      ).toEqual([{ qty: 1, unit_price_cents: 6500, variant: null }]);
      expect(db.prepare("SELECT steps FROM recipes").get().steps).toBe(
        "1. Brew\n2. Serve",
      );
      expect(
        db.prepare("SELECT ingredient, qty, unit FROM recipe_lines").all(),
      ).toEqual([{ ingredient: "Legacy Beans", qty: 18, unit: "g" }]);

      // The app serves the new Food items with parsed variants too.
      const api = authed(app);
      const menu = await api.get("/api/menu_items?active=1").expect(200);
      expect(menu.body.find((row) => row.name === "Siomai")).toMatchObject({
        price_cents: 5000,
        variants: ["Fried", "Steamed"],
      });
      expect(await api.get("/api/sales").expect(200)).toMatchObject({
        body: [expect.objectContaining({ total_cents: 6500 })],
      });
      expect((await api.get("/api/recipes").expect(200)).body).toHaveLength(1);
    } finally {
      app.locals.db.close();
    }
  });

  it("second boot preserves owner edits: no dupes, price 5500 and inactive flag stay", async () => {
    const dbPath = join(dir, "legacy-edits.db");
    buildLegacyDb(dbPath);

    const first = createApp(dbPath);
    first.locals.db
      .prepare("UPDATE menu_items SET price_cents = 5500 WHERE name = 'Siomai'")
      .run();
    first.locals.db
      .prepare("UPDATE menu_items SET active = 0 WHERE name = 'Fries'")
      .run();
    first.locals.db.close();

    const second = createApp(dbPath);
    try {
      const db = second.locals.db;
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM categories WHERE name = 'Food'")
          .get().n,
      ).toBe(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM menu_items WHERE name IN ('Siomai', 'Fries')",
          )
          .get().n,
      ).toBe(2);
      expect(
        db
          .prepare(
            "SELECT price_cents, variants FROM menu_items WHERE name = 'Siomai'",
          )
          .get(),
      ).toEqual({ price_cents: 5500, variants: '["Fried","Steamed"]' });
      expect(
        db.prepare("SELECT active FROM menu_items WHERE name = 'Fries'").get()
          .active,
      ).toBe(0);
    } finally {
      second.locals.db.close();
    }
  });

  it("fresh DB keeps the full seed: exactly one Food category with its menu", async () => {
    const dbPath = join(dir, "fresh.db");
    const app = createApp(dbPath);
    try {
      const db = app.locals.db;
      const foodCats = db
        .prepare("SELECT id, sort FROM categories WHERE name = 'Food'")
        .all();
      expect(foodCats).toHaveLength(1);
      expect(foodCats[0].sort).toBe(5);
      expect(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n).toBe(
        5,
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n).toBe(
        23,
      );
      const foodItems = db
        .prepare(
          "SELECT name, price_cents, variants FROM menu_items WHERE category_id = ? ORDER BY id",
        )
        .all(foodCats[0].id);
      expect(foodItems).toEqual([
        { name: "Siomai", price_cents: 5000, variants: '["Fried","Steamed"]' },
        {
          name: "Fries",
          price_cents: 5000,
          variants: '["Cheese","BBQ","Sour Cream"]',
        },
      ]);
    } finally {
      app.locals.db.close();
    }
  });
});
