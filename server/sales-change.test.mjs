import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authed } from "./test-auth.mjs";
import { createApp } from "./app.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-sales-change-test-"));
const app = createApp(join(dir, "sales-change-test.db"));
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

describe("sales cash received and change", () => {
  it("old DB without the columns opens via createApp with both columns added (boot migration)", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "solace-sales-change-legacy-"));
    const legacyPath = join(legacyDir, "legacy.db");
    try {
      const legacy = new Database(legacyPath);
      legacy.exec(
        "CREATE TABLE sales (id INTEGER PRIMARY KEY, total_cents INTEGER NOT NULL, payment TEXT NOT NULL CHECK (payment IN ('cash', 'gcash')), voided INTEGER NOT NULL DEFAULT 0, paid INTEGER NOT NULL DEFAULT 0, daily_seq INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)",
      );
      legacy
        .prepare(
          "INSERT INTO sales (total_cents, payment, voided, paid, daily_seq, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(5000, "cash", 0, 1, 1, "2026-01-05 10:00:00");
      legacy.close();

      const legacyApp = createApp(legacyPath);
      try {
        const cols = legacyApp.locals.db
          .prepare("PRAGMA table_info(sales)")
          .all()
          .map((col) => col.name);
        expect(cols).toContain("received_cents");
        expect(cols).toContain("change_cents");
        const legacyApi = authed(legacyApp);
        const list = await legacyApi.get("/api/sales").expect(200);
        expect(list.body).toHaveLength(1);
        expect(list.body[0]).toMatchObject({
          total_cents: 5000,
          received_cents: null,
          change_cents: null,
        });
      } finally {
        legacyApp.locals.db.close();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("PATCH {paid:1, received_cents} stores received and computes change", async () => {
    const item = await newItem("Change Drink", 8000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;
    expect(sale.received_cents).toBeNull();
    expect(sale.change_cents).toBeNull();

    const settled = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1, received_cents: sale.total_cents + 500 })
      .expect(200);
    expect(settled.body.paid).toBe(1);
    expect(settled.body.received_cents).toBe(sale.total_cents + 500);
    expect(settled.body.change_cents).toBe(500);

    const fetched = await api.get(`/api/sales/${sale.id}`).expect(200);
    expect(fetched.body.received_cents).toBe(sale.total_cents + 500);
    expect(fetched.body.change_cents).toBe(500);

    const list = await api.get("/api/sales").expect(200);
    expect(list.body.find((row) => row.id === sale.id)).toMatchObject({
      received_cents: sale.total_cents + 500,
      change_cents: 500,
    });
  });

  it("exact payment stores change 0", async () => {
    const item = await newItem("Exact Drink", 5000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;

    const settled = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1, received_cents: sale.total_cents })
      .expect(200);
    expect(settled.body.received_cents).toBe(sale.total_cents);
    expect(settled.body.change_cents).toBe(0);
  });

  it("PATCH received_cents below the total is rejected", async () => {
    const item = await newItem("Short Drink", 9000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;

    const bad = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1, received_cents: sale.total_cents - 100 })
      .expect(400);
    expect(bad.body.error).toBe("received_cents must cover the total");
  });

  it("PATCH non-integer received_cents is rejected", async () => {
    const item = await newItem("String Drink", 5000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;

    const bad = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1, received_cents: "500" })
      .expect(400);
    expect(bad.body.error).toBe("received_cents must be a non-negative integer");
  });

  it("PATCH received_cents without paid is rejected before the missing-flag guard", async () => {
    const item = await newItem("Requires Paid Drink", 5000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;

    const bad = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ received_cents: 500 })
      .expect(400);
    expect(bad.body.error).toBe("received_cents requires paid");
  });

  it("PATCH {paid:0} clears received and change on a settled sale", async () => {
    const item = await newItem("Clear Drink", 7000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "cash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;
    const settled = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1, received_cents: sale.total_cents + 300 })
      .expect(200);
    expect(settled.body.change_cents).toBe(300);

    const cleared = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 0 })
      .expect(200);
    expect(cleared.body.paid).toBe(0);
    expect(cleared.body.received_cents).toBeNull();
    expect(cleared.body.change_cents).toBeNull();
  });

  it("PATCH {paid:1} without received_cents leaves both as-is (GCash path)", async () => {
    const item = await newItem("Gcash Drink", 6000);
    const sale = (
      await api
        .post("/api/sales")
        .send({
          payment: "gcash",
          items: [{ menu_item_id: item.id, qty: 1 }],
        })
        .expect(201)
    ).body;

    const settled = await api
      .patch(`/api/sales/${sale.id}`)
      .send({ paid: 1 })
      .expect(200);
    expect(settled.body.paid).toBe(1);
    expect(settled.body.received_cents).toBeNull();
    expect(settled.body.change_cents).toBeNull();
  });
});
