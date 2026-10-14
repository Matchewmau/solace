import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.mjs";

// Unset-PIN app: everything behaves as today (no lock, no 401s).
const dirOpen = mkdtempSync(join(tmpdir(), "solace-pin-open-"));
const openApp = createApp(join(dirOpen, "open.db"), { pin: "" });

// Set-PIN app: mutations gated, sales + verify exempt.
const dirLocked = mkdtempSync(join(tmpdir(), "solace-pin-locked-"));
const lockedApp = createApp(join(dirLocked, "locked.db"), { pin: "1234" });

afterAll(() => {
  openApp.locals.db.close();
  lockedApp.locals.db.close();
  rmSync(dirOpen, { recursive: true, force: true });
  rmSync(dirLocked, { recursive: true, force: true });
});

describe("PIN unset: no lock, no 401s (regression)", () => {
  it("mutations work headerless and verify always ok", async () => {
    const cat = await request(openApp)
      .post("/api/categories")
      .send({ name: "NoPin" })
      .expect(201);
    const item = await request(openApp)
      .post("/api/menu_items")
      .send({ category_id: cat.body.id, name: "Drip", price_cents: 5000 })
      .expect(201);
    await request(openApp)
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.body.id, qty: 1 }] })
      .expect(201);
    const verify = await request(openApp)
      .post("/api/auth/verify")
      .send({ pin: "anything" })
      .expect(200);
    expect(verify.body).toEqual({ ok: true });
  });
});

describe("PIN set: verify endpoint", () => {
  it("correct PIN -> 200 {ok:true}; wrong PIN -> 401 {ok:false}", async () => {
    const good = await request(lockedApp)
      .post("/api/auth/verify")
      .send({ pin: "1234" })
      .expect(200);
    expect(good.body).toEqual({ ok: true });

    const bad = await request(lockedApp)
      .post("/api/auth/verify")
      .send({ pin: "0000" })
      .expect(401);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.error).toEqual(expect.any(String));
  });
});

describe("PIN set: mutation gate with sales exemption", () => {
  it("POST category without header -> 401; with header -> 201", async () => {
    const denied = await request(lockedApp)
      .post("/api/categories")
      .send({ name: "Gated" })
      .expect(401);
    expect(denied.body).toEqual({ error: "pin required" });

    const allowed = await request(lockedApp)
      .post("/api/categories")
      .set("x-solace-pin", "1234")
      .send({ name: "Gated" })
      .expect(201);
    expect(allowed.body.name).toBe("Gated");
  });

  it("wrong PIN header -> 401", async () => {
    await request(lockedApp)
      .post("/api/categories")
      .set("x-solace-pin", "9999")
      .send({ name: "Nope" })
      .expect(401);
  });

  it("POST sale without header -> 201 (register must flow); GETs stay open", async () => {
    const cat = (
      await request(lockedApp)
        .post("/api/categories")
        .set("x-solace-pin", "1234")
        .send({ name: "Reg" })
        .expect(201)
    ).body;
    const item = (
      await request(lockedApp)
        .post("/api/menu_items")
        .set("x-solace-pin", "1234")
        .send({ category_id: cat.id, name: "Reg Drink", price_cents: 6000 })
        .expect(201)
    ).body;

    const sale = await request(lockedApp)
      .post("/api/sales")
      .send({ payment: "cash", items: [{ menu_item_id: item.id, qty: 1 }] })
      .expect(201);
    expect(sale.body.total_cents).toBe(6000);

    await request(lockedApp).get("/api/categories").expect(200);
    await request(lockedApp).get(`/api/sales/${sale.body.id}`).expect(200);
  });

  it("PATCH/PUT/DELETE gated: void without header -> 401, with -> 200", async () => {
    const cat = (
      await request(lockedApp)
        .post("/api/categories")
        .set("x-solace-pin", "1234")
        .send({ name: "Voidable" })
        .expect(201)
    ).body;
    const item = (
      await request(lockedApp)
        .post("/api/menu_items")
        .set("x-solace-pin", "1234")
        .send({ category_id: cat.id, name: "Void Drink", price_cents: 4000 })
        .expect(201)
    ).body;
    const sale = (
      await request(lockedApp)
        .post("/api/sales")
        .send({ payment: "gcash", items: [{ menu_item_id: item.id, qty: 1 }] })
        .expect(201)
    ).body;

    await request(lockedApp)
      .patch(`/api/sales/${sale.id}`)
      .send({ voided: 1 })
      .expect(401);
    const voided = await request(lockedApp)
      .patch(`/api/sales/${sale.id}`)
      .set("x-solace-pin", "1234")
      .send({ voided: 1 })
      .expect(200);
    expect(voided.body.voided).toBe(1);

    // PUT items and DELETE category also gated.
    await request(lockedApp)
      .put(`/api/sales/${sale.id}/items`)
      .send({ items: [{ menu_item_id: item.id, qty: 1 }] })
      .expect(401);
    await request(lockedApp).delete(`/api/categories/${cat.id}`).expect(401);
    await request(lockedApp)
      .delete(`/api/categories/${cat.id}`)
      .set("x-solace-pin", "1234")
      .expect(400); // gated pass-through: category in use -> domain 400
  });
});
