import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.mjs";
import { authed } from "./test-auth.mjs";

// Default-credential app: solace / solace123.
const dir = mkdtempSync(join(tmpdir(), "solace-auth-login-"));
const app = createApp(join(dir, "login.db"));
const api = authed(app);

afterAll(() => {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/auth/login", () => {
  it("solace/solace123 -> 200 {ok:true}", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "solace", password: "solace123" })
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("bad combo -> 401 {ok:false, error}", async () => {
    for (const body of [
      { username: "solace", password: "wrong" },
      { username: "nobody", password: "solace123" },
      { username: "solace", password: "" },
      {},
    ]) {
      const res = await request(app)
        .post("/api/auth/login")
        .send(body)
        .expect(401);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });
});

describe("auth gate on all other /api routes", () => {
  it("logged-out GET /api/menu_items -> 401 {error}", async () => {
    const res = await request(app).get("/api/menu_items").expect(401);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("logged-out POST /api/categories -> 401 {error}", async () => {
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "Nope" })
      .expect(401);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it("wrong x-solace-auth header -> 401", async () => {
    await request(app)
      .get("/api/menu_items")
      .set("x-solace-auth", "wrong")
      .expect(401);
  });

  it("authed GET /api/menu_items -> 200", async () => {
    const res = await api.get("/api/menu_items").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("authed unknown /api route stays a JSON 404", async () => {
    const res = await api.get("/api/nope").expect(404);
    expect(res.body.error).toEqual(expect.any(String));
  });
});

describe("SOLACE_USER / SOLACE_PASS overrides", () => {
  it("login and header honor env credentials", async () => {
    const savedUser = process.env.SOLACE_USER;
    const savedPass = process.env.SOLACE_PASS;
    process.env.SOLACE_USER = "boss";
    process.env.SOLACE_PASS = "s3cret";
    const dirEnv = mkdtempSync(join(tmpdir(), "solace-auth-env-"));
    const envApp = createApp(join(dirEnv, "env.db"));
    try {
      await request(envApp)
        .post("/api/auth/login")
        .send({ username: "solace", password: "solace123" })
        .expect(401);
      const good = await request(envApp)
        .post("/api/auth/login")
        .send({ username: "boss", password: "s3cret" })
        .expect(200);
      expect(good.body).toEqual({ ok: true });
      await request(envApp).get("/api/menu_items").expect(401);
      await authed(envApp, "s3cret").get("/api/menu_items").expect(200);
    } finally {
      envApp.locals.db.close();
      rmSync(dirEnv, { recursive: true, force: true });
      if (savedUser === undefined) delete process.env.SOLACE_USER;
      else process.env.SOLACE_USER = savedUser;
      if (savedPass === undefined) delete process.env.SOLACE_PASS;
      else process.env.SOLACE_PASS = savedPass;
    }
  });
});
