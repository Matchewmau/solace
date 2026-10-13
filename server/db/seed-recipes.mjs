// Recipe seed: upserts RECIPES into an existing DB, matched by exact menu name.
// Usage: node server/db/seed-recipes.mjs [db-path]
//   (default: SOLACE_DB env or server/data/solace.db, CWD-relative).
// Rules: upserts recipes by menu_item_id (sets steps); replaces that recipe's
// recipe_lines (delete-by-recipe + insert) inside one transaction — lines are
// owned by the recipe, never shared. Never deletes menu items, never wipes,
// safe on a DB that already has sales. Prints a per-drink ok/missing summary;
// exit code is non-zero when any RECIPES menu_item name matches no menu row.
// Offline only: no network calls.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPES } from "./recipe-data.mjs";

const DB_DIR = dirname(fileURLToPath(import.meta.url));

export function seedRecipes(dbPath, recipes = RECIPES) {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(DB_DIR, "schema.sql"), "utf8"));

  const ok = [];
  const missing = [];
  const seed = db.transaction(() => {
    const findItem = db.prepare("SELECT id FROM menu_items WHERE name = ?");
    const upsertRecipe = db.prepare(
      "INSERT INTO recipes (menu_item_id, steps) VALUES (?, ?) " +
        "ON CONFLICT (menu_item_id) DO UPDATE SET steps = excluded.steps",
    );
    const recipeIdFor = db.prepare(
      "SELECT id FROM recipes WHERE menu_item_id = ?",
    );
    const clearLines = db.prepare(
      "DELETE FROM recipe_lines WHERE recipe_id = ?",
    );
    const addLine = db.prepare(
      "INSERT INTO recipe_lines (recipe_id, ingredient, qty, unit) VALUES (?, ?, ?, ?)",
    );
    for (const recipe of recipes) {
      const item = findItem.get(recipe.menu_item);
      if (!item) {
        missing.push(recipe.menu_item);
        continue;
      }
      upsertRecipe.run(item.id, recipe.steps);
      const recipeId = recipeIdFor.get(item.id).id;
      clearLines.run(recipeId);
      for (const line of recipe.lines) {
        addLine.run(recipeId, line.ingredient, line.qty, line.unit);
      }
      ok.push(recipe.menu_item);
    }
  });
  seed();
  db.close();
  return { ok, missing };
}

const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const target =
    process.argv[2] ?? process.env.SOLACE_DB ?? join("server", "data", "solace.db");
  const { ok, missing } = seedRecipes(target);
  for (const name of ok) {
    console.log(`ok: ${name}`);
  }
  for (const name of missing) {
    console.log(`missing menu item: ${name}`);
  }
  console.log(`recipes: ${ok.length} ok, ${missing.length} missing`);
  if (missing.length > 0) {
    process.exitCode = 1;
  }
}
