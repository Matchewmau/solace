import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-sales-edit-payment-test-"));
const app = createApp(join(dir, "sales-edit-payment-test.db"));
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function makeItem(name, priceCents) {
  const cat = await api
    .post("/api/categories")
    .send({ name: `${name} Cat` })
    .expect(201);
  const item = await api
    .post("/api/menu_items")
    .send({ category_id: cat.body.id, name, price_cents: priceCents })
    .expect(201);
  return item.body;
}

async function postSale(body) {
  return (await api.post("/api/sales").send(body).expect(201)).body;
}

describe("PUT /api/sales/:id/items payment", () => {
  it("changes payment on an unpaid sale while replacing items", async () => {
    const item = await makeItem("Edit Payment Drink", 8000);
    const sale = await postSale({
      payment: "cash",
      items: [{ menu_item_id: item.id, qty: 1 }],
    });
    expect(sale.payment).toBe("cash");
    expect(sale.total_cents).toBe(8000);

    const updated = await api
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: item.id, qty: 2 }], payment: "gcash" })
      .expect(200);

    expect(updated.body.payment).toBe("gcash");
    expect(updated.body.total_cents).toBe(16000);
    expect(updated.body.received_cents).toBeNull();
    expect(updated.body.change_cents).toBeNull();

    const fetched = await api.get(`/api/sales/${sale.id}`).expect(200);
    expect(fetched.body.payment).toBe("gcash");
    expect(fetched.body.total_cents).toBe(16000);
  });

  it("rejects an invalid payment on edit", async () => {
    const item = await makeItem("Edit Bad Payment", 5000);
    const sale = await postSale({
      payment: "cash",
      items: [{ menu_item_id: item.id, qty: 1 }],
    });

    const res = await api
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: item.id, qty: 1 }], payment: "card" })
      .expect(400);
    expect(res.body.error).toBe("payment must be 'cash' or 'gcash'");

    const fetched = await api.get(`/api/sales/${sale.id}`).expect(200);
    expect(fetched.body.payment).toBe("cash");
  });

  it("refuses a payment change on a paid sale", async () => {
    const item = await makeItem("Edit Paid Payment", 6000);
    const sale = await postSale({
      payment: "cash",
      paid: 1,
      items: [{ menu_item_id: item.id, qty: 1 }],
    });
    expect(sale.paid).toBe(1);

    const res = await api
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: item.id, qty: 1 }], payment: "gcash" })
      .expect(400);
    expect(res.body.error).toBe("cannot change payment on a paid sale");

    const fetched = await api.get(`/api/sales/${sale.id}`).expect(200);
    expect(fetched.body.payment).toBe("cash");
  });

  it("still allows an item-only edit on a paid sale", async () => {
    const item = await makeItem("Edit Paid Items Only", 7000);
    const sale = await postSale({
      payment: "gcash",
      paid: 1,
      items: [{ menu_item_id: item.id, qty: 1 }],
    });

    const updated = await api
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: item.id, qty: 3 }] })
      .expect(200);
    expect(updated.body.payment).toBe("gcash");
    expect(updated.body.total_cents).toBe(21000);
  });
});
