// Seed script: creates the DB, applies schema.sql, inserts minimal smoke rows.
// Usage: node server/db/seed.mjs [db-path]  (default: server/data/solace.db, relative to CWD)
// Money is INTEGER cents; timestamps are TEXT 'YYYY-MM-DD HH:MM:SS'.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DB_DIR = dirname(fileURLToPath(import.meta.url));

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function seedDb(dbPath) {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(DB_DIR, "schema.sql"), "utf8"));

  const stamp = nowStamp();
  const insert = db.transaction(() => {
    const categoryId = db
      .prepare("INSERT INTO categories (name, sort) VALUES ('Smoke', 0)")
      .run().lastInsertRowid;
    const menuItemId = db
      .prepare(
        "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active) VALUES (?, 'Smoke Drink', 7000, 2000, 1)",
      )
      .run(categoryId).lastInsertRowid;
    const saleId = db
      .prepare(
        "INSERT INTO sales (total_cents, payment, created_at) VALUES (7000, 'cash', ?)",
      )
      .run(stamp).lastInsertRowid;
    db.prepare(
      "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents) VALUES (?, ?, 1, 7000)",
    ).run(saleId, menuItemId);
    const stockItemId = db
      .prepare(
        "INSERT INTO stock_items (name, unit, qty, low_threshold) VALUES ('Smoke Beans', 'g', 1000, 100)",
      )
      .run().lastInsertRowid;
    db.prepare(
      "INSERT INTO stock_movements (stock_item_id, delta, reason, created_at) VALUES (?, 1000, 'delivery', ?)",
    ).run(stockItemId, stamp);
    const recipeId = db
      .prepare("INSERT INTO recipes (menu_item_id, steps) VALUES (?, 'Smoke steps')")
      .run(menuItemId).lastInsertRowid;
    db.prepare(
      "INSERT INTO recipe_lines (recipe_id, ingredient, qty, unit) VALUES (?, 'Smoke beans', 18, 'g')",
    ).run(recipeId);
    db.prepare(
      "INSERT INTO expenses (date, category, amount_cents, note) VALUES ('2026-10-13', 'Smoke', 5000, '')",
    ).run();
    db.prepare(
      "INSERT INTO bills (name, amount_cents, due_day, paid) VALUES ('Smoke Power', 300000, 15, 0)",
    ).run();
    db.prepare(
      "INSERT INTO payables (label, amount_cents, due_date, paid) VALUES ('Smoke Supplier', 10000, '2026-10-20', 0)",
    ).run();
    const loanId = db
      .prepare(
        "INSERT INTO loans (lender, principal_cents, balance_cents, installment_cents, due_day) VALUES ('Smoke Lender', 5000000, 5000000, 500000, 5)",
      )
      .run().lastInsertRowid;
    db.prepare(
      "INSERT INTO loan_payments (loan_id, amount_cents, paid_at) VALUES (?, 500000, ?)",
    ).run(loanId, stamp);
  });
  insert();
  return db;
}

const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const target = process.argv[2] ?? join("server", "data", "solace.db");
  const db = seedDb(target);
  console.log(`seeded ${resolve(target)}`);
  db.close();
}
