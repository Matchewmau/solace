import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-sales-delete-test-"));
const app = createApp(join(dir, "sales-delete-test.db"));
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function newItem(name, priceCents) {
  const cat = await api
    .post("/api/categories")
    .send({ name: `${name} Category` })
    .expect(201);
  const item = await api
    .post("/api/menu_items")
    .send({ category_id: cat.body.id, name, price_cents: priceCents })
    .expect(201);
  return item.body;
}

async function newSale(itemId, paid = 0) {
  const sale = await api
    .post("/api/sales")
    .send({
      payment: "cash",
      paid,
      items: [{ menu_item_id: itemId, qty: 2 }],
    })
    .expect(201);
  return sale.body;
}

describe("DELETE /api/sales/:id", () => {
  it("removes an unpaid sale and its items", async () => {
    const item = await newItem("Delete Cortado", 7000);
    const sale = await newSale(item.id);
    expect(
      app.locals.db
        .prepare("SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ?")
        .get(sale.id).n,
    ).toBe(1);

    await api.delete(`/api/sales/${sale.id}`).expect(204);

    await api.get(`/api/sales/${sale.id}`).expect(404);
    const list = await api.get("/api/sales").expect(200);
    expect(list.body.find((row) => row.id === sale.id)).toBeUndefined();
    expect(
      app.locals.db
        .prepare("SELECT COUNT(*) AS n FROM sale_items WHERE sale_id = ?")
        .get(sale.id).n,
    ).toBe(0);
  });

  it("refuses to delete a paid sale and leaves it intact", async () => {
    const item = await newItem("Paid Latte", 8000);
    const sale = await newSale(item.id, 1);

    const rejected = await api.delete(`/api/sales/${sale.id}`).expect(400);
    expect(rejected.body.error).toBe("cannot delete a paid sale");

    const fetched = await api.get(`/api/sales/${sale.id}`).expect(200);
    expect(fetched.body.paid).toBe(1);
    expect(fetched.body.items).toHaveLength(1);
  });

  it("returns 404 for an unknown sale", async () => {
    const missing = await api.delete("/api/sales/999999").expect(404);
    expect(missing.body.error).toBe("sale not found");
  });
});
