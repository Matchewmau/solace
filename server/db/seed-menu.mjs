// Menu seed: upserts MENU categories/items into an existing DB.
// Usage: node server/db/seed-menu.mjs [db-path]
//   (default: SOLACE_DB env or server/data/solace.db, CWD-relative).
// Rules: upsert categories by name; upsert items by (category_id, name);
// re-runs apply price corrections; existing active flags are preserved
// EXCEPT Dark Mocha, which is forced inactive; never deletes, never wipes,
// safe on a DB that already has sales (no dupes).
// Money is INTEGER cents. Offline only: no network calls.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MENU } from "./menu-data.mjs";

const DB_DIR = dirname(fileURLToPath(import.meta.url));

export function seedMenu(dbPath) {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(DB_DIR, "schema.sql"), "utf8"));

  const counts = {};
  const seed = db.transaction(() => {
    let sort = 0;
    for (const group of MENU) {
      sort += 1;
      const existingCat = db
        .prepare("SELECT id FROM categories WHERE name = ?")
        .get(group.category);
      const categoryId = existingCat
        ? existingCat.id
        : db
            .prepare("INSERT INTO categories (name, sort) VALUES (?, ?)")
            .run(group.category, sort).lastInsertRowid;
      for (const item of group.items) {
        const forceInactive = item.name === "Dark Mocha";
        const existing = db
          .prepare(
            "SELECT id FROM menu_items WHERE category_id = ? AND name = ?",
          )
          .get(categoryId, item.name);
        if (existing) {
          if (forceInactive) {
            db.prepare(
              "UPDATE menu_items SET price_cents = ?, active = 0 WHERE id = ?",
            ).run(item.price_cents, existing.id);
          } else {
            db.prepare("UPDATE menu_items SET price_cents = ? WHERE id = ?").run(
              item.price_cents,
              existing.id,
            );
          }
        } else {
          db.prepare(
            "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active) VALUES (?, ?, ?, 0, ?)",
          ).run(
            categoryId,
            item.name,
            item.price_cents,
            forceInactive ? 0 : (item.active ?? 1),
          );
        }
      }
      counts[group.category] = {
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
  });
  seed();

  const totalActive = db
    .prepare("SELECT COUNT(*) AS n FROM menu_items WHERE active = 1")
    .get().n;
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
