import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("PUT /api/recipes is still 404 {error}", async () => {
    const res = await api.put("/api/recipes").send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual(expect.any(String));
  });
});

describe("recipes write API (Task 5)", () => {
  let drinkId;
  let friesId;
  let createdId;

  beforeAll(async () => {
    const cats = await api.get("/api/categories").expect(200);
    const coffee = cats.body.find((c) => c.name === "Coffee");
    const items = await api.get("/api/menu_items").expect(200);
    friesId = items.body.find((m) => m.name === "Fries").id;
    const fresh = await api
      .post("/api/menu_items")
      .send({
        category_id: coffee.id,
        name: "Guide Test Drink",
        price_cents: 7000,
      })
      .expect(201);
    drinkId = fresh.body.id;
  });

  it("POST recipe requires an existing drink without a guide", async () => {
    const res = await api.post("/api/recipes").send({ menu_item_id: drinkId, steps: "1. Milk\n2. Mix", lines: [{ ingredient: "Milk", qty: 70, unit: "ml" }] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ menu_item_id: drinkId });
    expect(typeof res.body.steps).toBe("string");
    createdId = res.body.id;
  });

  it("POST recipe for a Food item fails with 400", async () => {
    const res = await api.post("/api/recipes").send({ menu_item_id: friesId, steps: "Fry", lines: [] });
    expect(res.status).toBe(400);
  });

  it("POST duplicate guide for the same drink returns 400", async () => {
    const res = await api
      .post("/api/recipes")
      .send({ menu_item_id: drinkId, steps: "1. Other", lines: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("POST unknown menu_item_id returns 400", async () => {
    const res = await api
      .post("/api/recipes")
      .send({ menu_item_id: 999999, steps: "1. Mix", lines: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("PATCH updates steps/lines for the same drink", async () => {
    const res = await api
      .patch(`/api/recipes/${createdId}`)
      .send({
        steps: "1. Milk\n2. Mix well",
        lines: [{ ingredient: "Milk", qty: 80, unit: "ml" }],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      id: createdId,
      menu_item_id: drinkId,
      steps: "1. Milk\n2. Mix well",
    });
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({
      ingredient: "Milk",
      qty: 80,
      unit: "ml",
    });
  });

  it("PATCH a recipe onto a different drink fails with 400", async () => {
    const res = await api
      .patch(`/api/recipes/${createdId}`)
      .send({ menu_item_id: friesId, steps: "1. X" });
    expect(res.status).toBe(400);
  });

  it("PATCH unknown recipe returns 404", async () => {
    const res = await api
      .patch("/api/recipes/999999")
      .send({ steps: "1. X" });
    expect(res.status).toBe(404);
  });

  it("DELETE returns 204, removes guide only, menu item still GETs 200", async () => {
    await api.delete(`/api/recipes/${createdId}`).expect(204);
    await api.get(`/api/recipes/${createdId}`).expect(404);
    await api.get(`/api/menu_items/${drinkId}`).expect(200);
  });

  it("DELETE unknown recipe returns 404", async () => {
    const res = await api.delete("/api/recipes/999999");
    expect(res.status).toBe(404);
  });
});
