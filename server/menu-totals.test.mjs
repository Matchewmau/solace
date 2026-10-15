import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-menu-totals-test-"));
const app = createApp(join(dir, "menu-totals-test.db"));
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("menu item sales totals", () => {
  it("GET sales-totals excludes voided sales", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Totals Cat" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Totals Item", price_cents: 5000 })
      .expect(201);
    const id = item.body.id;
    const kept = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: id, qty: 2 }] })
      .expect(201);
    expect(kept.body.total_cents).toBe(10000);
    const voided = await api
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: id, qty: 3 }] })
      .expect(201);
    await api.patch(`/api/sales/${voided.body.id}`).send({ voided: 1 }).expect(200);
    expect((await api.get(`/api/menu_items/${id}/sales-totals`)).body).toEqual({ menu_item_id: id, total_qty: 2, total_revenue_cents: 10000 });
  });

  it("GET sales-totals returns zeros when no sales", async () => {
    const cat = await api
      .post("/api/categories")
      .send({ name: "Totals Empty Cat" })
      .expect(201);
    const item = await api
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Totals Empty Item", price_cents: 5000 })
      .expect(201);
    const res = await api.get(`/api/menu_items/${item.body.id}/sales-totals`).expect(200);
    expect(res.body).toEqual({ menu_item_id: item.body.id, total_qty: 0, total_revenue_cents: 0 });
  });

  it("GET sales-totals returns 404 for unknown item", async () => {
    const res = await api.get("/api/menu_items/999999/sales-totals").expect(404);
    expect(res.body.error).toEqual(expect.any(String));
  });
});
