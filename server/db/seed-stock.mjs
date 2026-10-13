// Stock seed: builds stock_items from DISTINCT recipe_lines pairs.
// Usage: node server/db/seed-stock.mjs [db-path]
//   (default: SOLACE_DB env or server/data/solace.db, CWD-relative).
// Rules: one stock_items row per DISTINCT (ingredient, unit) pair with
// qty 0, low_threshold 0; idempotent (SELECT-first match by name+unit, skip
// existing, never deletes, never updates); safe on a DB that already has
// sales or movements. Prints created/skipped counts.
// Offline only: no network calls.
//
// ICE-UNIT DECISION (binds Task 10): recipe_lines.unit is NULL for
// unmeasured lines (Ice — qty/unit null in recipe-data.mjs) while
// stock_items.unit is NOT NULL, so a NULL unit is stored as '' (empty
// string). Ice is seeded like every other ingredient; the operator sets
// real counts afterwards (all rows start at qty 0).
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DB_DIR = dirname(fileURLToPath(import.meta.url));

export function seedStock(dbPath) {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(DB_DIR, "schema.sql"), "utf8"));

  const pairs = db
    .prepare(
      "SELECT DISTINCT ingredient AS name, unit FROM recipe_lines ORDER BY ingredient, unit",
    )
    .all();
  let created = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    const find = db.prepare(
      "SELECT id FROM stock_items WHERE name = ? AND unit = ?",
    );
    const add = db.prepare(
      "INSERT INTO stock_items (name, unit, qty, low_threshold) VALUES (?, ?, 0, 0)",
    );
    for (const pair of pairs) {
      const unit = pair.unit ?? "";
      if (find.get(pair.name, unit)) {
        skipped += 1;
        continue;
      }
      add.run(pair.name, unit);
      created += 1;
    }
  });
  run();
  db.close();
  console.log(`stock: ${created} created, ${skipped} skipped`);
  return { created, skipped };
}

const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const target =
    process.argv[2] ?? process.env.SOLACE_DB ?? join("server", "data", "solace.db");
  seedStock(target);
}
