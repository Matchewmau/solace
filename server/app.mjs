// Solace Cafe LAN server: Express + better-sqlite3, one process serving
// GET /api/* and static client/dist. REST conventions (binding for all tasks):
// JSON everywhere; plural nouns; GET 200 / POST 201 / PATCH 200 / DELETE 204;
// errors {error} with 400/404/500; money *_cents ints; timestamps YYYY-MM-DD HH:MM:SS.
import Database from "better-sqlite3";
import express from "express";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(SERVER_DIR, "..", "client", "dist");

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function openDb(dbPath) {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(join(SERVER_DIR, "db", "schema.sql"), "utf8"));
  return db;
}

function isInt(value) {
  return Number.isInteger(value);
}

function parseId(raw) {
  const id = Number(raw);
  return isInt(id) && id > 0 ? id : null;
}

export function createApp(dbPath) {
  const db = openDb(dbPath);
  const app = express();
  app.locals.db = db;
  app.use(express.json());

  const sendError = (res, status, message) =>
    res.status(status).json({ error: message });

  // --- categories ---
  app.get("/api/categories", (req, res) => {
    const rows = db
      .prepare("SELECT id, name, sort FROM categories ORDER BY sort, id")
      .all();
    res.json(rows);
  });

  app.post("/api/categories", (req, res) => {
    const { name, sort = 0 } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return sendError(res, 400, "name is required");
    }
    if (!isInt(sort)) {
      return sendError(res, 400, "sort must be an integer");
    }
    try {
      const info = db
        .prepare("INSERT INTO categories (name, sort) VALUES (?, ?)")
        .run(name.trim(), sort);
      const row = db
        .prepare("SELECT id, name, sort FROM categories WHERE id = ?")
        .get(info.lastInsertRowid);
      res.status(201).json(row);
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "category already exists");
      }
      throw err;
    }
  });

  app.get("/api/categories/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id
      ? db
          .prepare("SELECT id, name, sort FROM categories WHERE id = ?")
          .get(id)
      : undefined;
    if (!row) return sendError(res, 404, "category not found");
    res.json(row);
  });

  app.patch("/api/categories/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db
          .prepare("SELECT id, name, sort FROM categories WHERE id = ?")
          .get(id)
      : undefined;
    if (!current) return sendError(res, 404, "category not found");
    const { name = current.name, sort = current.sort } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return sendError(res, 400, "name is required");
    }
    if (!isInt(sort)) {
      return sendError(res, 400, "sort must be an integer");
    }
    try {
      db.prepare("UPDATE categories SET name = ?, sort = ? WHERE id = ?").run(
        name.trim(),
        sort,
        id,
      );
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "category already exists");
      }
      throw err;
    }
    res.json(
      db
        .prepare("SELECT id, name, sort FROM categories WHERE id = ?")
        .get(id),
    );
  });

  app.delete("/api/categories/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "category not found");
    try {
      const info = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
      if (info.changes === 0) return sendError(res, 404, "category not found");
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "category is in use by menu items");
      }
      throw err;
    }
    res.status(204).end();
  });

  // --- menu_items ---
  const MENU_COLS =
    "id, category_id, name, price_cents, cost_cents, active";

  app.get("/api/menu_items", (req, res) => {
    const where = [];
    const params = [];
    if (req.query.category_id !== undefined) {
      const categoryId = Number(req.query.category_id);
      if (!isInt(categoryId)) {
        return sendError(res, 400, "category_id must be an integer");
      }
      where.push("category_id = ?");
      params.push(categoryId);
    }
    if (req.query.active !== undefined) {
      if (req.query.active !== "0" && req.query.active !== "1") {
        return sendError(res, 400, "active must be 0 or 1");
      }
      where.push("active = ?");
      params.push(Number(req.query.active));
    }
    const rows = db
      .prepare(
        `SELECT ${MENU_COLS} FROM menu_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
      )
      .all(...params);
    res.json(rows);
  });

  app.post("/api/menu_items", (req, res) => {
    const {
      category_id,
      name,
      price_cents,
      cost_cents = 0,
      active = 1,
    } = req.body ?? {};
    if (!isInt(category_id)) {
      return sendError(res, 400, "category_id must be an integer");
    }
    if (
      !db
        .prepare("SELECT id FROM categories WHERE id = ?")
        .get(category_id)
    ) {
      return sendError(res, 400, "unknown category_id");
    }
    if (typeof name !== "string" || name.trim() === "") {
      return sendError(res, 400, "name is required");
    }
    if (!isInt(price_cents) || price_cents < 0) {
      return sendError(res, 400, "price_cents must be a non-negative integer");
    }
    if (!isInt(cost_cents) || cost_cents < 0) {
      return sendError(res, 400, "cost_cents must be a non-negative integer");
    }
    if (active !== 0 && active !== 1) {
      return sendError(res, 400, "active must be 0 or 1");
    }
    try {
      const info = db
        .prepare(
          "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active) VALUES (?, ?, ?, ?, ?)",
        )
        .run(category_id, name.trim(), price_cents, cost_cents, active);
      res
        .status(201)
        .json(
          db
            .prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`)
            .get(info.lastInsertRowid),
        );
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "menu item already exists");
      }
      throw err;
    }
  });

  app.get("/api/menu_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id
      ? db
          .prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`)
          .get(id)
      : undefined;
    if (!row) return sendError(res, 404, "menu item not found");
    res.json(row);
  });

  app.patch("/api/menu_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db
          .prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`)
          .get(id)
      : undefined;
    if (!current) return sendError(res, 404, "menu item not found");
    const {
      category_id = current.category_id,
      name = current.name,
      price_cents = current.price_cents,
      cost_cents = current.cost_cents,
      active = current.active,
    } = req.body ?? {};
    if (!isInt(category_id)) {
      return sendError(res, 400, "category_id must be an integer");
    }
    if (
      !db
        .prepare("SELECT id FROM categories WHERE id = ?")
        .get(category_id)
    ) {
      return sendError(res, 400, "unknown category_id");
    }
    if (typeof name !== "string" || name.trim() === "") {
      return sendError(res, 400, "name is required");
    }
    if (!isInt(price_cents) || price_cents < 0) {
      return sendError(res, 400, "price_cents must be a non-negative integer");
    }
    if (!isInt(cost_cents) || cost_cents < 0) {
      return sendError(res, 400, "cost_cents must be a non-negative integer");
    }
    if (active !== 0 && active !== 1) {
      return sendError(res, 400, "active must be 0 or 1");
    }
    try {
      db.prepare(
        "UPDATE menu_items SET category_id = ?, name = ?, price_cents = ?, cost_cents = ?, active = ? WHERE id = ?",
      ).run(category_id, name.trim(), price_cents, cost_cents, active, id);
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "menu item already exists");
      }
      throw err;
    }
    res.json(
      db.prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`).get(id),
    );
  });

  app.delete("/api/menu_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "menu item not found");
    try {
      const info = db.prepare("DELETE FROM menu_items WHERE id = ?").run(id);
      if (info.changes === 0) return sendError(res, 404, "menu item not found");
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "menu item is referenced by sales");
      }
      throw err;
    }
    res.status(204).end();
  });

  // --- sales ---
  const SALE_COLS = "id, total_cents, payment, voided, created_at";

  function saleWithItems(saleId) {
    const sale = db
      .prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`)
      .get(saleId);
    if (!sale) return undefined;
    sale.items = db
      .prepare(
        "SELECT id, menu_item_id, qty, unit_price_cents FROM sale_items WHERE sale_id = ? ORDER BY id",
      )
      .all(saleId);
    return sale;
  }

  // Shared by POST /api/sales and PUT /api/sales/:id/items: look up ACTIVE
  // prices and compute the total server-side. Client-supplied totals are
  // ignored (never read). Returns {lines} or {error}.
  function resolveItemLines(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return { error: "items must be a non-empty array" };
    }
    const lines = [];
    for (const line of items) {
      const menuItemId = line?.menu_item_id;
      const qty = line?.qty;
      if (!isInt(menuItemId)) {
        return { error: "menu_item_id must be an integer" };
      }
      if (!isInt(qty) || qty < 1) {
        return { error: "qty must be an integer of at least 1" };
      }
      const menuItem = db
        .prepare("SELECT id, price_cents FROM menu_items WHERE id = ? AND active = 1")
        .get(menuItemId);
      if (!menuItem) {
        return { error: `unknown or inactive menu_item_id: ${menuItemId}` };
      }
      lines.push({
        menu_item_id: menuItem.id,
        qty,
        unit_price_cents: menuItem.price_cents,
      });
    }
    return { lines };
  }

  app.post("/api/sales", (req, res) => {
    const { payment, items } = req.body ?? {};
    if (payment !== "cash" && payment !== "gcash") {
      return sendError(res, 400, "payment must be 'cash' or 'gcash'");
    }
    // Look up ACTIVE prices; the total is always computed server-side.
    const resolved = resolveItemLines(items);
    if (resolved.error) {
      return sendError(res, 400, resolved.error);
    }
    const lines = resolved.lines;
    const total = lines.reduce(
      (sum, line) => sum + line.unit_price_cents * line.qty,
      0,
    );
    const insert = db.transaction(() => {
      const saleId = db
        .prepare(
          "INSERT INTO sales (total_cents, payment, created_at) VALUES (?, ?, ?)",
        )
        .run(total, payment, nowStamp()).lastInsertRowid;
      const addLine = db.prepare(
        "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents) VALUES (?, ?, ?, ?)",
      );
      for (const line of lines) {
        addLine.run(
          saleId,
          line.menu_item_id,
          line.qty,
          line.unit_price_cents,
        );
      }
      return saleId;
    });
    res.status(201).json(saleWithItems(insert()));
  });

  app.get("/api/sales", (req, res) => {
    const where = [];
    const params = [];
    if (req.query.voided !== undefined) {
      if (req.query.voided !== "0" && req.query.voided !== "1") {
        return sendError(res, 400, "voided must be 0 or 1");
      }
      where.push("voided = ?");
      params.push(Number(req.query.voided));
    }
    // ISO date prefix filters on the sortable YYYY-MM-DD HH:MM:SS stamps.
    if (req.query.since !== undefined) {
      where.push("created_at >= ?");
      params.push(String(req.query.since));
    }
    if (req.query.until !== undefined) {
      const until = String(req.query.until);
      where.push("created_at <= ?");
      params.push(
        /^\d{4}-\d{2}-\d{2}$/.test(until) ? `${until} 23:59:59` : until,
      );
    }
    const rows = db
      .prepare(
        `SELECT ${SALE_COLS} FROM sales${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
      )
      .all(...params);
    res.json(rows);
  });

  // --- daily summary (registered BEFORE /:id so /summary is never swallowed) ---
  // DAY-BOUNDARY RULING (binds Task 8 + Task 13): the day is the UTC calendar
  // date, i.e. the created_at TEXT prefix YYYY-MM-DD. created_at stamps are
  // written in UTC ("YYYY-MM-DD HH:MM:SS" via Date.toISOString), so filtering
  // `created_at LIKE 'date%'` selects exactly one UTC date. Valid because shop
  // hours 2pm-10pm PHT = 06:00-14:00 UTC, always inside one UTC date; no
  // overnight sales exist.
  app.get("/api/sales/summary", (req, res) => {
    const raw = req.query.date;
    const date =
      raw === undefined ? new Date().toISOString().slice(0, 10) : String(raw);
    const dayStart = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(dayStart.getTime()) ||
      dayStart.toISOString().slice(0, 10) !== date
    ) {
      return sendError(res, 400, "date must be YYYY-MM-DD");
    }
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN payment = 'cash' AND voided = 0 THEN total_cents ELSE 0 END), 0) AS cash_total_cents,
           COALESCE(SUM(CASE WHEN payment = 'gcash' AND voided = 0 THEN total_cents ELSE 0 END), 0) AS gcash_total_cents,
           COALESCE(SUM(CASE WHEN voided = 0 THEN 1 ELSE 0 END), 0) AS sale_count,
           COALESCE(SUM(CASE WHEN voided = 1 THEN 1 ELSE 0 END), 0) AS voided_count
         FROM sales WHERE created_at LIKE ?`,
      )
      .get(`${date}%`);
    res.json({
      date,
      cash_total_cents: row.cash_total_cents,
      gcash_total_cents: row.gcash_total_cents,
      sale_count: row.sale_count,
      voided_count: row.voided_count,
    });
  });

  app.get("/api/sales/:id", (req, res) => {
    const id = parseId(req.params.id);
    const sale = id ? saleWithItems(id) : undefined;
    if (!sale) return sendError(res, 404, "sale not found");
    res.json(sale);
  });

  // Reversible void flag: {voided: 0|1}. Unvoid (0) restores the sale to totals.
  app.patch("/api/sales/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db.prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`).get(id)
      : undefined;
    if (!current) return sendError(res, 404, "sale not found");
    const { voided } = req.body ?? {};
    if (voided !== 0 && voided !== 1) {
      return sendError(res, 400, "voided must be 0 or 1");
    }
    db.prepare("UPDATE sales SET voided = ? WHERE id = ?").run(voided, id);
    res.json(saleWithItems(id));
  });

  // Replace a sale's items, recomputing total_cents from ACTIVE prices with
  // the same rules as POST (client totals ignored). Refused on voided sales:
  // unvoid first. Shop practice is void + re-ring; this endpoint exists so
  // corrections stay server-priced without deleting history.
  app.put("/api/sales/:id/items", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db.prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`).get(id)
      : undefined;
    if (!current) return sendError(res, 404, "sale not found");
    if (current.voided === 1) {
      return sendError(res, 400, "unvoid sale before editing items");
    }
    const { items } = req.body ?? {};
    const resolved = resolveItemLines(items);
    if (resolved.error) {
      return sendError(res, 400, resolved.error);
    }
    const lines = resolved.lines;
    const total = lines.reduce(
      (sum, line) => sum + line.unit_price_cents * line.qty,
      0,
    );
    const replace = db.transaction(() => {
      db.prepare("DELETE FROM sale_items WHERE sale_id = ?").run(id);
      const addLine = db.prepare(
        "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents) VALUES (?, ?, ?, ?)",
      );
      for (const line of lines) {
        addLine.run(
          id,
          line.menu_item_id,
          line.qty,
          line.unit_price_cents,
        );
      }
      db.prepare("UPDATE sales SET total_cents = ? WHERE id = ?").run(total, id);
    });
    replace();
    res.json(saleWithItems(id));
  });

  // Unknown /api routes are JSON 404s, never the SPA fallback.
  app.use("/api", (req, res) => sendError(res, 404, "not found"));

  // --- static frontend ---
  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
  }
  app.get("*", (req, res) => {
    const index = join(DIST_DIR, "index.html");
    if (existsSync(index)) {
      res.sendFile(index);
    } else {
      sendError(
        res,
        503,
        "Frontend not built. Run `npm run build` to generate client/dist.",
      );
    }
  });

  // Malformed JSON bodies -> 400 {error}; everything else -> 500 {error}.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      return sendError(res, 400, "invalid JSON body");
    }
    sendError(res, 500, "internal server error");
  });

  return app;
}
