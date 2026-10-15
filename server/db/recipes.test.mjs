import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.mjs";
import { MENU } from "./menu-data.mjs";
import { RECIPES } from "./recipe-data.mjs";
import { seedMenu } from "./seed-menu.mjs";
import { seedRecipes } from "./seed-recipes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_RECIPES = join(HERE, "seed-recipes.mjs");

// All 21 drink names (20 active + inactive Dark Mocha) — the coverage binding.
// Food (Siomai/Fries) is excluded: food has no guides.
const MENU_NAMES = MENU.filter((g) => g.category !== "Food").flatMap((g) =>
  g.items.map((i) => i.name),
);

const dir = mkdtempSync(join(tmpdir(), "solace-recipe-test-"));
const dbPath = join(dir, "recipe-test.db");

seedMenu(dbPath);
const first = seedRecipes(dbPath);
const second = seedRecipes(dbPath);
const app = createApp(dbPath);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

function recipeFor(name) {
  return app.locals.db
    .prepare(
      `SELECT r.id, r.steps, m.name AS menu_item_name
         FROM recipes r JOIN menu_items m ON m.id = r.menu_item_id
         WHERE m.name = ?`,
    )
    .get(name);
}

function linesFor(recipeId) {
  return app.locals.db
    .prepare(
      "SELECT ingredient, qty, unit FROM recipe_lines WHERE recipe_id = ? ORDER BY id",
    )
    .all(recipeId);
}

function lineMap(name) {
  const row = recipeFor(name);
  expect(row, `recipe for ${name}`).toBeDefined();
  return new Map(linesFor(row.id).map((l) => [l.ingredient, l]));
}

describe("recipe data faithfulness", () => {
  it("RECIPES covers exactly the 21 drink names (20 active + Dark Mocha)", () => {
    expect(MENU_NAMES).toHaveLength(21);
    expect(RECIPES.map((r) => r.menu_item).sort()).toEqual(
      [...MENU_NAMES].sort(),
    );
  });

  it("seedRecipes reports 21/21 ok with nothing missing, idempotently", () => {
    expect(first.missing).toEqual([]);
    expect(first.ok).toHaveLength(21);
    expect(second.missing).toEqual([]);
    expect(second.ok).toHaveLength(21);
  });

  it("all 21 drink items (incl. inactive Dark Mocha) have a recipe row", () => {
    const { n } = app.locals.db
      .prepare(
        `SELECT COUNT(*) AS n FROM recipes r
           JOIN menu_items m ON m.id = r.menu_item_id`,
      )
      .get();
    expect(n).toBe(21);
    for (const name of MENU_NAMES) {
      expect(recipeFor(name), `missing recipe for ${name}`).toBeDefined();
    }
  });

  it("every recipe has lines; every drink has an unmeasured Ice line", () => {
    for (const name of MENU_NAMES) {
      const row = recipeFor(name);
      const lines = linesFor(row.id);
      expect(lines.length, `lines for ${name}`).toBeGreaterThan(0);
      expect(
        lines.some((l) => l.qty !== null),
        `measured line for ${name}`,
      ).toBe(true);
      const ice = lines.find((l) => l.ingredient === "Ice");
      expect(ice, `Ice line for ${name}`).toBeDefined();
      expect(ice.qty).toBeNull();
      expect(ice.unit).toBeNull();
    }
  });

  it("spot-checks PDF quantities verbatim", () => {
    expect(lineMap("Spanish Latte").get("Condensed Milk")).toMatchObject({
      qty: 40,
      unit: "ml",
    });
    expect(lineMap("Spanish Latte").get("Coffee")).toMatchObject({
      qty: 120,
      unit: "ml",
    });
    expect(lineMap("Salted Caramel").get("S.C syrup")).toMatchObject({
      qty: 25,
      unit: "ml",
    });
    expect(lineMap("Dark Mocha").get("Condensed Milk")).toMatchObject({
      qty: 5,
      unit: "ml",
    });
    expect(lineMap("Dark Mocha").get("D. Mocha base")).toMatchObject({
      qty: 15,
      unit: "ml",
    });
    expect(lineMap("Milosaurus").get("Milo")).toMatchObject({
      qty: 2,
      unit: "scoop",
    });
    expect(lineMap("Matcha Latte").get("Mat. powder")).toMatchObject({
      qty: 15,
      unit: "g",
    });
    expect(lineMap("Matcha Berry").get("Hot water")).toMatchObject({
      qty: 100,
      unit: "ml",
    });
    expect(lineMap("Cookies & Cream").get("Oreo")).toMatchObject({
      qty: 1,
      unit: "Pack",
    });
    expect(lineMap("Milky Mixed Berries").get("BB jam")).toMatchObject({
      qty: 10,
      unit: "ml",
    });
    expect(lineMap("Green Apple Soda").get("G.A syrup")).toMatchObject({
      qty: 35,
      unit: "ml",
    });
    expect(lineMap("Mixed Berries Soda").get("Sprite")).toMatchObject({
      qty: 1,
      unit: "btl",
    });
    expect(lineMap("Mixed Berries Soda").get("Sinkers")).toMatchObject({
      qty: 5,
      unit: "ml",
    });
  });

  it("steps name the drink's own ingredients and end in Mix (except Green Apple)", () => {
    for (const recipe of RECIPES) {
      const row = recipeFor(recipe.menu_item);
      expect(row.steps).toBe(recipe.steps);
      expect(row.steps.length).toBeGreaterThan(0);
      if (recipe.menu_item === "Green Apple Soda") {
        expect(row.steps).not.toMatch(/mix/i);
      } else {
        expect(row.steps).toMatch(/mix/i);
      }
    }
  });

  it("re-runs restore tampered steps and drop stray lines (no dupes)", () => {
    const row = recipeFor("Spanish Latte");
    app.locals.db
      .prepare("UPDATE recipes SET steps = ? WHERE id = ?")
      .run("tampered", row.id);
    app.locals.db
      .prepare(
        "INSERT INTO recipe_lines (recipe_id, ingredient, qty, unit) VALUES (?, 'Stray', 1, 'ml')",
      )
      .run(row.id);
    seedRecipes(dbPath);
    expect(recipeFor("Spanish Latte").steps).toBe(
      RECIPES.find((r) => r.menu_item === "Spanish Latte").steps,
    );
    const ingredients = linesFor(row.id).map((l) => l.ingredient);
    expect(ingredients).not.toContain("Stray");
    expect(new Set(ingredients).size).toBe(ingredients.length);
    const { n } = app.locals.db
      .prepare("SELECT COUNT(*) AS n FROM recipes")
      .get();
    expect(n).toBe(21);
  });
});

describe("seed-recipes unmatched handling", () => {
  it("reports an unknown drink as missing without throwing", () => {
    const result = seedRecipes(dbPath, [
      { menu_item: "No Such Drink", steps: "x", lines: [] },
    ]);
    expect(result.ok).toEqual([]);
    expect(result.missing).toEqual(["No Such Drink"]);
  });

  it("CLI exits 0 on a seeded DB", () => {
    const run = spawnSync(process.execPath, [SEED_RECIPES, dbPath], {
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/recipes: 21 ok, 0 missing/);
  });

  it("CLI exits non-zero on a DB with no menu (every drink unmatched)", () => {
    const emptyDb = join(dir, "empty.db");
    const run = spawnSync(process.execPath, [SEED_RECIPES, emptyDb], {
      encoding: "utf8",
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toMatch(/recipes: 0 ok, 21 missing/);
    const db = new Database(emptyDb);
    try {
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM recipes").get().n,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
