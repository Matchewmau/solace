import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.mjs";

function makeApp(opts) {
  const dir = mkdtempSync(join(tmpdir(), "solace-tablet-test-"));
  const app = createApp(join(dir, "tablet.db"), opts);
  return { app, dir };
}

function cleanup({ app, dir }) {
  app.locals.db.close();
  rmSync(dir, { recursive: true, force: true });
}

describe("GET /tablet", () => {
  it("renders the LAN URL and a QR SVG without auth", async () => {
    const ctx = makeApp({ lanIp: "192.168.1.50", port: 4567 });

    try {
      const res = await request(ctx.app)
        .get("/tablet")
        .expect(200)
        .expect("Content-Type", /text\/html/);

      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).toContain("Solace on your tablet");
      expect(res.text).toContain("Scan this code");
      expect(res.text).toContain("http://192.168.1.50:4567");
      expect(res.text).toContain("<svg");
    } finally {
      cleanup(ctx);
    }
  });

  it("recomputes the LAN address on every request", async () => {
    let calls = 0;
    const ctx = makeApp({
      lanIp: () => (calls++ === 0 ? "192.168.1.50" : "192.168.1.51"),
      port: 3000,
    });

    try {
      const first = await request(ctx.app).get("/tablet").expect(200);
      const second = await request(ctx.app).get("/tablet").expect(200);

      expect(first.text).toContain("http://192.168.1.50:3000");
      expect(second.text).toContain("http://192.168.1.51:3000");
    } finally {
      cleanup(ctx);
    }
  });

  it("shows a warning when the laptop has no LAN address", async () => {
    const ctx = makeApp({ lanIp: null, port: 3000 });

    try {
      const res = await request(ctx.app).get("/tablet").expect(200);

      expect(res.text).toContain(
        "This laptop is not connected to the local network.",
      );
      expect(res.text).not.toContain("<svg");
    } finally {
      cleanup(ctx);
    }
  });
});
