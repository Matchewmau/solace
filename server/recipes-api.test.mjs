import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";
import { seedMenu } from "./db/seed-menu.mjs";
import { seedRecipes } from "./db/seed-recipes.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-recipes-api-test-"));
const dbPath = join(dir, "recipes-api-test.db");
seedMenu(dbPath);
seedRecipes(dbPath);
const app = createApp(dbPath);
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recipes read API (Task 9)", () => {
  it("GET /api/recipes returns all 21 with item names", async () => {
    const res = await api.get("/api/recipes").expect(200);
    expect(res.body).toHaveLength(21);
    const names = res.body.map((r) => r.menu_item_name);
    expect(names).toContain("Spanish Latte");
    expect(names).toContain("Dark Mocha");
    expect(names).toContain("Mixed Berries Soda");
    for (const row of res.body) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("menu_item_id");
      expect(row).toHaveProperty("menu_item_name");
      expect(row).toHaveProperty("steps");
    }
  });

  it("GET /api/recipes?menu_item_id= filters; bad value -> 400; unknown id -> []", async () => {
    const all = await api.get("/api/recipes").expect(200);
    const target = all.body.find((r) => r.menu_item_name === "Milosaurus");
    const filtered = await api
      .get(`/api/recipes?menu_item_id=${target.menu_item_id}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0]).toMatchObject({
      menu_item_name: "Milosaurus",
    });

    const empty = await api
      .get("/api/recipes?menu_item_id=999999")
      .expect(200);
    expect(empty.body).toEqual([]);

    const bad = await api
      .get("/api/recipes?menu_item_id=abc")
      .expect(400);
    expect(bad.body.error).toEqual(expect.any(String));
  });

  it("GET /api/recipes/:id embeds lines + menu_item_name; unknown -> 404 {error}", async () => {
    const all = await api.get("/api/recipes").expect(200);
    const target = all.body.find((r) => r.menu_item_name === "Spanish Latte");
    const res = await api
      .get(`/api/recipes/${target.id}`)
      .expect(200);
    expect(res.body).toMatchObject({
      id: target.id,
      menu_item_id: target.menu_item_id,
      menu_item_name: "Spanish Latte",
    });
    expect(typeof res.body.steps).toBe("string");
    const condensed = res.body.lines.find(
      (l) => l.ingredient === "Condensed Milk",
    );
    expect(condensed).toMatchObject({ qty: 40, unit: "ml" });
    const ice = res.body.lines.find((l) => l.ingredient === "Ice");
    expect(ice).toMatchObject({ qty: null, unit: null });

    const missing = await api.get("/api/recipes/999999").expect(404);
    expect(missing.body.error).toEqual(expect.any(String));
    const nonNumeric = await api.get("/api/recipes/abc").expect(404);
    expect(nonNumeric.body.error).toEqual(expect.any(String));
  });

  it("recipes are read-only: POST/PUT/PATCH/DELETE -> 404", async () => {
    for (const method of ["post", "put", "patch", "delete"]) {
      const res = await api[method]("/api/recipes").send({});
      expect(res.status).toBe(404);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });
});
