import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { seedDb } from "./seed.mjs";

const EXPECTED_TABLES = [
  "categories",
  "menu_items",
  "sales",
  "sale_items",
  "stock_items",
  "stock_movements",
  "recipes",
  "recipe_lines",
  "expenses",
  "bills",
  "payables",
  "loans",
  "loan_payments",
  "salaries",
];

const dir = mkdtempSync(join(tmpdir(), "solace-schema-test-"));
const dbPath = join(dir, "test.db");
const db = seedDb(dbPath);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function tableNames() {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

describe("solace schema", () => {
  it("creates all 14 tables", () => {
    expect(tableNames().sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it("seeds every table non-empty", () => {
    for (const table of EXPECTED_TABLES) {
      const { n } = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
        .get();
      expect(n, `table ${table} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("rejects a bad payment value via CHECK", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO sales (total_cents, payment, created_at) VALUES (100, 'card', '2026-10-13 00:00:00')",
        )
        .run(),
    ).toThrow();
  });

  it("has foreign keys enforced on the seed connection", () => {
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() =>
      db
        .prepare(
          "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents) VALUES (999999, 999999, 1, 100)",
        )
        .run(),
    ).toThrow();
  });

  it("opens a fresh readable copy via better-sqlite3", () => {
    const reopened = new Database(dbPath, { readonly: true });
    try {
      const { n } = reopened
        .prepare("SELECT COUNT(*) AS n FROM menu_items")
        .get();
      expect(n).toBeGreaterThan(0);
    } finally {
      reopened.close();
    }
  });
});
