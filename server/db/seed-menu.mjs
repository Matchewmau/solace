// Menu seed: upserts MENU categories/items into an existing DB.
// Usage: node server/db/seed-menu.mjs [db-path]
//   (default: SOLACE_DB env or server/data/solace.db, CWD-relative).
// Rules: upsert categories by name; upsert items by (category_id, name);
// re-runs apply price corrections and backfill variants; existing active
// flags are preserved EXCEPT Dark Mocha, which is forced inactive; Food is
// always normalized to sort max-plus-one (last); never deletes, never wipes,
// safe on a DB that already has sales (no dupes).
// Money is INTEGER cents. Offline only: no network calls.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MENU } from "./menu-data.mjs";

const DB_DIR = dirname(fileURLToPath(import.meta.url));

// Upsert one MENU group: its category by name (Food seeds after any
// foreign/operator categories at max sort plus one; drinks keep their
// sequential slot) plus its items by (category_id, name). Returns the
// group's item { total, active } counts. Shared by the full seed and the
// Food-only bootstrap so the two can never drift apart.
function seedGroup(db, group, sort) {
  const existingCat = db
    .prepare("SELECT id FROM categories WHERE name = ?")
    .get(group.category);
  let categoryId;
  if (existingCat) {
    categoryId = existingCat.id;
  } else {
    const sortValue =
      group.category === "Food"
        ? db.prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM categories")
            .get().m + 1
        : sort;
    categoryId = db
      .prepare("INSERT INTO categories (name, sort) VALUES (?, ?)")
      .run(group.category, sortValue).lastInsertRowid;
  }
  if (group.category === "Food") {
    // Food stays last across re-runs even when other categories sort higher.
    const maxOther = db
      .prepare(
        "SELECT COALESCE(MAX(sort), 0) AS m FROM categories WHERE id != ?",
      )
      .get(categoryId).m;
    db.prepare("UPDATE categories SET sort = ? WHERE id = ?").run(
      maxOther + 1,
      categoryId,
    );
  }
  for (const item of group.items) {
    const forceInactive = item.name === "Dark Mocha";
    const variantsJson = JSON.stringify(item.variants ?? []);
    const existing = db
      .prepare("SELECT id FROM menu_items WHERE category_id = ? AND name = ?")
      .get(categoryId, item.name);
    if (existing) {
      if (forceInactive) {
        db.prepare(
          "UPDATE menu_items SET price_cents = ?, variants = ?, active = 0 WHERE id = ?",
        ).run(item.price_cents, variantsJson, existing.id);
      } else {
        db.prepare(
          "UPDATE menu_items SET price_cents = ?, variants = ? WHERE id = ?",
        ).run(item.price_cents, variantsJson, existing.id);
      }
    } else {
      db.prepare(
        "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active, variants) VALUES (?, ?, ?, 0, ?, ?)",
      ).run(
        categoryId,
        item.name,
        item.price_cents,
        forceInactive ? 0 : (item.active ?? 1),
        variantsJson,
      );
    }
  }
  return {
    total: db
      .prepare("SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?")
      .get(categoryId).n,
    active: db
      .prepare(
        "SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ? AND active = 1",
      )
      .get(categoryId).n,
  };
}

export function seedMenuDb(db) {
  const counts = {};
  const seed = db.transaction(() => {
    let sort = 0;
    for (const group of MENU) {
      sort += 1;
      counts[group.category] = seedGroup(db, group, sort);
    }
  });
  seed();

  const totalActive = db
    .prepare("SELECT COUNT(*) AS n FROM menu_items WHERE active = 1")
    .get().n;
  return { counts, totalActive };
}

// Targeted Food-only bootstrap for legacy DBs: upserts just the Food group
// (category plus Siomai/Fries) so pre-Food databases gain the menu without
// re-running the full seed and its price corrections. createApp calls this
// only when no Food category exists, keeping it a one-time backfill that
// never touches owner edits afterwards.
export function seedFoodDb(db) {
  const food = MENU.find((group) => group.category === "Food");
  const counts = {};
  const seed = db.transaction(() => {
    counts[food.category] = seedGroup(db, food, 0);
  });
  seed();

  const totalActive = db
    .prepare("SELECT COUNT(*) AS n FROM menu_items WHERE active = 1")
    .get().n;
  return { counts, totalActive };
}

export function seedMenu(dbPath) {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(DB_DIR, "schema.sql"), "utf8"));

  const { counts, totalActive } = seedMenuDb(db);
  for (const group of MENU) {
    const c = counts[group.category];
    console.log(`${group.category}: ${c.total} items (${c.active} active)`);
  }
  console.log(`total active: ${totalActive}`);
  db.close();
  return { counts, totalActive };
}

const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const target =
    process.argv[2] ?? process.env.SOLACE_DB ?? join("server", "data", "solace.db");
  seedMenu(target);
}
