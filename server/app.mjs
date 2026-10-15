// Solace Cafe LAN server: Express + better-sqlite3, one process serving
// GET /api/* and static client/dist. REST conventions (binding for all tasks):
// JSON everywhere; plural nouns; GET 200 / POST 201 / PATCH 200 / DELETE 204;
// errors {error} with 400/404/500; money *_cents ints; timestamps YYYY-MM-DD HH:MM:SS.
import Database from "better-sqlite3";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedMenuDb } from "./db/seed-menu.mjs";
import { seedRecipesDb } from "./db/seed-recipes.mjs";

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
  // Boot migration: pre-price Task 4 DBs lack stock_items.price_cents
  // (CREATE TABLE IF NOT EXISTS never alters existing tables), so add it
  // when missing. DEFAULT 0 backfills old rows.
  const stockCols = db
    .prepare("PRAGMA table_info(stock_items)")
    .all()
    .map((col) => col.name);
  if (!stockCols.includes("price_cents")) {
    db.exec(
      "ALTER TABLE stock_items ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0",
    );
  }
  const salesCols = db
    .prepare("PRAGMA table_info(sales)")
    .all()
    .map((col) => col.name);
  if (!salesCols.includes("paid")) {
    db.exec("ALTER TABLE sales ADD COLUMN paid INTEGER NOT NULL DEFAULT 0");
  }
  if (!salesCols.includes("daily_seq")) {
    db.exec("ALTER TABLE sales ADD COLUMN daily_seq INTEGER NOT NULL DEFAULT 1");
    // Backfill old rows: the DEFAULT 1 above stamps every pre-existing row
    // as Order #1, so same-UTC-date rows would collide. Recompute dense
    // per-UTC-date ROW_NUMBER() ORDER BY id. Safe for new-code rows too:
    // allocation is COUNT+1 including voided and sales are never deleted,
    // so recompute is identity for them.
    db.exec(
      "UPDATE sales SET daily_seq = (SELECT COUNT(*) FROM sales s2 WHERE substr(s2.created_at, 1, 10) = substr(sales.created_at, 1, 10) AND s2.id <= sales.id)",
    );
  }
  // Variant columns (guide-menu Task 1): pre-variant DBs lack
  // menu_items.variants and sale_items.variant (CREATE TABLE IF NOT EXISTS
  // never alters existing tables), so add them when missing. The '[]'
  // DEFAULT backfills old menu rows with no variants; sale variant stays
  // NULL when no choice was offered.
  const menuCols = db
    .prepare("PRAGMA table_info(menu_items)")
    .all()
    .map((col) => col.name);
  if (!menuCols.includes("variants")) {
    db.exec("ALTER TABLE menu_items ADD COLUMN variants TEXT NOT NULL DEFAULT '[]'");
  }
  const saleItemCols = db
    .prepare("PRAGMA table_info(sale_items)")
    .all()
    .map((col) => col.name);
  if (!saleItemCols.includes("variant")) {
    db.exec("ALTER TABLE sale_items ADD COLUMN variant TEXT");
  }
  return db;
}

function isInt(value) {
  return Number.isInteger(value);
}

function parseId(raw) {
  const id = Number(raw);
  return isInt(id) && id > 0 ? id : null;
}

export function createApp(dbPath, opts = {}) {
  const db = openDb(dbPath);
  // Boot auto-seed: fill empty menu/recipes from the seed sources (upsert,
  // never delete, never wipe — safe on a DB with sales).
  if (db.prepare("SELECT COUNT(*) AS n FROM menu_items").get().n === 0) {
    seedMenuDb(db);
  }
  if (db.prepare("SELECT COUNT(*) AS n FROM recipes").get().n === 0) {
    seedRecipesDb(db);
  }
  const app = express();
  app.locals.db = db;
  app.use(express.json());

  const sendError = (res, status, message) =>
    res.status(status).json({ error: message });

  // --- shared login (replaces the old PIN lock; LAN-only single credential) ---
  // Env SOLACE_USER / SOLACE_PASS (defaults solace / solace123). The client
  // sends the password back as the x-solace-auth header on every other /api
  // request. Threat model is a trusted LAN (no public internet): the password
  // is a casual lock against curious taps, not a security boundary — hence
  // plaintext env compare and no brute-force machinery (documented, YAGNI).
  const serverUser = opts.user ?? process.env.SOLACE_USER ?? "solace";
  const serverPass = opts.pass ?? process.env.SOLACE_PASS ?? "solace123";

  // Constant-time string compare (length-mismatch short-circuits false
  // without leaking prefix info through early exit).
  function authMatches(candidate, expected) {
    const a = Buffer.from(String(candidate ?? ""));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  // Gate: ALL /api endpoints except POST /api/auth/login require the
  // x-solace-auth header matching the password — including GETs (stricter
  // than the old PIN gate, which left GETs open).
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && req.path === "/auth/login") return next();
    if (authMatches(req.get("x-solace-auth") ?? "", serverPass)) return next();
    return sendError(res, 401, "auth required");
  });

  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body ?? {};
    if (
      authMatches(username, serverUser) &&
      authMatches(password, serverPass)
    ) {
      return res.json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: "invalid credentials" });
  });

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
    "id, category_id, name, price_cents, cost_cents, active, variants";

  function parseVariants(raw) {
    try {
      const parsed = JSON.parse(raw ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function withVariants(row) {
    if (!row) return row;
    return { ...row, variants: parseVariants(row.variants) };
  }

  // Accept array or comma string; split commas, trim, drop empties,
  // dedupe case-insensitively keeping first case, max 8 items each
  // 1-30 chars else 400. Parens are literal characters inside an option.
  function normalizeVariants(input) {
    let parts;
    if (typeof input === "string") {
      parts = input.split(",");
    } else if (Array.isArray(input)) {
      parts = [];
      for (const elem of input) {
        if (typeof elem !== "string") {
          return {
            error: "variants must be an array of strings or a comma-separated string",
          };
        }
        parts.push(...elem.split(","));
      }
    } else {
      return {
        error: "variants must be an array of strings or a comma-separated string",
      };
    }
    const trimmed = parts.map((part) => part.trim()).filter((part) => part !== "");
    const seen = new Set();
    const variants = [];
    for (const option of trimmed) {
      const key = option.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        variants.push(option);
      }
    }
    if (variants.length > 8) {
      return { error: "variants must have at most 8 options" };
    }
    for (const option of variants) {
      if (option.length < 1 || option.length > 30) {
        return { error: "variant option must be 1-30 characters" };
      }
    }
    return { variants };
  }

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
    res.json(rows.map(withVariants));
  });

  app.post("/api/menu_items", (req, res) => {
    const {
      category_id,
      name,
      price_cents,
      cost_cents = 0,
      active = 1,
    } = req.body ?? {};
    const rawVariants = req.body?.variants;
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
    let variants = [];
    if (rawVariants !== undefined) {
      const normalized = normalizeVariants(rawVariants);
      if (normalized.error) return sendError(res, 400, normalized.error);
      variants = normalized.variants;
    }
    // App-level duplicate guard: schema has no UNIQUE(category_id, name),
    // so check before insert (keeps POS buttons duplicate-free on prod DBs).
    const trimmedName = name.trim();
    const clash = db
      .prepare("SELECT id FROM menu_items WHERE category_id = ? AND name = ?")
      .get(category_id, trimmedName);
    if (clash) {
      return sendError(res, 400, "menu item already exists");
    }
    try {
      const info = db
        .prepare(
          "INSERT INTO menu_items (category_id, name, price_cents, cost_cents, active, variants) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          category_id,
          trimmedName,
          price_cents,
          cost_cents,
          active,
          JSON.stringify(variants),
        );
      res
        .status(201)
        .json(
          withVariants(
            db
              .prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`)
              .get(info.lastInsertRowid),
          ),
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
    res.json(withVariants(row));
  });

  app.patch("/api/menu_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db
          .prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`)
          .get(id)
      : undefined;
    if (!current) return sendError(res, 404, "menu item not found");
    const currentVariants = parseVariants(current.variants);
    const {
      category_id = current.category_id,
      name = current.name,
      price_cents = current.price_cents,
      cost_cents = current.cost_cents,
      active = current.active,
    } = req.body ?? {};
    const rawVariants = req.body?.variants;
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
    let variants = currentVariants;
    if (rawVariants !== undefined) {
      const normalized = normalizeVariants(rawVariants);
      if (normalized.error) return sendError(res, 400, normalized.error);
      variants = normalized.variants;
      const used = db
        .prepare(
          "SELECT DISTINCT variant FROM sale_items WHERE menu_item_id = ? AND variant IS NOT NULL",
        )
        .all(id)
        .map((row) => row.variant);
      const nextKeys = new Set(variants.map((option) => option.toLowerCase()));
      for (const historic of used) {
        const key = String(historic).trim().toLowerCase();
        if (key === "") continue;
        if (!nextKeys.has(key)) {
          return sendError(
            res,
            400,
            `cannot remove variant in use: ${historic}`,
          );
        }
      }
    }
    // App-level rename-clash guard (same reason as the POST pre-check).
    const trimmedName = name.trim();
    const clash = db
      .prepare(
        "SELECT id FROM menu_items WHERE category_id = ? AND name = ? AND id != ?",
      )
      .get(category_id, trimmedName, id);
    if (clash) {
      return sendError(res, 400, "menu item already exists");
    }
    try {
      db.prepare(
        "UPDATE menu_items SET category_id = ?, name = ?, price_cents = ?, cost_cents = ?, active = ?, variants = ? WHERE id = ?",
      ).run(
        category_id,
        trimmedName,
        price_cents,
        cost_cents,
        active,
        JSON.stringify(variants),
        id,
      );
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "menu item already exists");
      }
      throw err;
    }
    res.json(
      withVariants(
        db.prepare(`SELECT ${MENU_COLS} FROM menu_items WHERE id = ?`).get(id),
      ),
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
  const SALE_COLS =
    "id, total_cents, payment, voided, paid, daily_seq, created_at";

  function saleWithItems(saleId) {
    const sale = db
      .prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`)
      .get(saleId);
    if (!sale) return undefined;
    sale.items = db
      .prepare(
        "SELECT id, menu_item_id, qty, unit_price_cents, variant FROM sale_items WHERE sale_id = ? ORDER BY id",
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
        .prepare("SELECT id, price_cents, variants FROM menu_items WHERE id = ? AND active = 1")
        .get(menuItemId);
      if (!menuItem) {
        return { error: `unknown or inactive menu_item_id: ${menuItemId}` };
      }
      const allowed = parseVariants(menuItem.variants);
      const variant = line?.variant ?? null;
      if (variant === null) {
        lines.push({
          menu_item_id: menuItem.id,
          qty,
          unit_price_cents: menuItem.price_cents,
          variant: null,
        });
        continue;
      }
      if (typeof variant !== "string" || !allowed.includes(variant)) {
        return { error: `unknown variant: ${variant}` };
      }
      lines.push({
        menu_item_id: menuItem.id,
        qty,
        unit_price_cents: menuItem.price_cents,
        variant,
      });
    }
    return { lines };
  }

  app.post("/api/sales", (req, res) => {
    const { payment, items, paid = 0 } = req.body ?? {};
    if (payment !== "cash" && payment !== "gcash") {
      return sendError(res, 400, "payment must be 'cash' or 'gcash'");
    }
    if (paid !== 0 && paid !== 1) {
      return sendError(res, 400, "paid must be 0 or 1");
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
      // Server owns the daily Order # sequence: COUNT of today's UTC-date
      // sales + 1, allocated here inside the sale transaction so Done taps
      // can never duplicate numbers. Abandoned tabs never POST, so no gaps.
      const stamp = nowStamp();
      const dailySeq =
        db
          .prepare("SELECT COUNT(*) AS n FROM sales WHERE created_at LIKE ?")
          .get(`${stamp.slice(0, 10)}%`).n + 1;
      const saleId = db
        .prepare(
          "INSERT INTO sales (total_cents, payment, paid, daily_seq, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(total, payment, paid, dailySeq, stamp).lastInsertRowid;
      const addLine = db.prepare(
        "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents, variant) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of lines) {
        addLine.run(
          saleId,
          line.menu_item_id,
          line.qty,
          line.unit_price_cents,
          line.variant,
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
           COALESCE(SUM(CASE WHEN voided = 1 THEN 1 ELSE 0 END), 0) AS voided_count,
           COUNT(*) AS day_count
         FROM sales WHERE created_at LIKE ?`,
      )
      .get(`${date}%`);
    res.json({
      date,
      cash_total_cents: row.cash_total_cents,
      gcash_total_cents: row.gcash_total_cents,
      sale_count: row.sale_count,
      voided_count: row.voided_count,
      // Counts ALL rows for the UTC date (including voided) so this always
      // equals the next allocated daily_seq (POST uses COUNT(all)+1).
      next_order_number: row.day_count + 1,
    });
  });

  app.get("/api/sales/:id", (req, res) => {
    const id = parseId(req.params.id);
    const sale = id ? saleWithItems(id) : undefined;
    if (!sale) return sendError(res, 404, "sale not found");
    res.json(sale);
  });

  // Reversible void/paid flags: {voided?: 0|1, paid?: 0|1}, at least one
  // present. Unvoid (0) restores the sale to totals.
  app.patch("/api/sales/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db.prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`).get(id)
      : undefined;
    if (!current) return sendError(res, 404, "sale not found");
    const { voided = current.voided, paid = current.paid } = req.body ?? {};
    if (req.body?.voided === undefined && req.body?.paid === undefined) {
      return sendError(res, 400, "voided must be 0 or 1");
    }
    if (voided !== 0 && voided !== 1) {
      return sendError(res, 400, "voided must be 0 or 1");
    }
    if (paid !== 0 && paid !== 1) {
      return sendError(res, 400, "paid must be 0 or 1");
    }
    db.prepare("UPDATE sales SET voided = ?, paid = ? WHERE id = ?").run(
      voided,
      paid,
      id,
    );
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
        "INSERT INTO sale_items (sale_id, menu_item_id, qty, unit_price_cents, variant) VALUES (?, ?, ?, ?, ?)",
      );
      for (const line of lines) {
        addLine.run(
          id,
          line.menu_item_id,
          line.qty,
          line.unit_price_cents,
          line.variant,
        );
      }
      db.prepare("UPDATE sales SET total_cents = ? WHERE id = ?").run(total, id);
    });
    replace();
    res.json(saleWithItems(id));
  });

  // --- recipes (read-only barista guide; seeded from the brew PDF) ---
  const RECIPE_COLS =
    "r.id, r.menu_item_id, m.name AS menu_item_name, r.steps";

  function recipeLines(recipeId) {
    return db
      .prepare(
        "SELECT id, ingredient, qty, unit FROM recipe_lines WHERE recipe_id = ? ORDER BY id",
      )
      .all(recipeId);
  }

  app.get("/api/recipes", (req, res) => {
    const where = [];
    const params = [];
    if (req.query.menu_item_id !== undefined) {
      const menuItemId = Number(req.query.menu_item_id);
      if (!isInt(menuItemId)) {
        return sendError(res, 400, "menu_item_id must be an integer");
      }
      where.push("r.menu_item_id = ?");
      params.push(menuItemId);
    }
    const rows = db
      .prepare(
        `SELECT ${RECIPE_COLS} FROM recipes r JOIN menu_items m ON m.id = r.menu_item_id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY r.id`,
      )
      .all(...params);
    res.json(rows);
  });

  app.get("/api/recipes/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id
      ? db
          .prepare(
            `SELECT ${RECIPE_COLS} FROM recipes r JOIN menu_items m ON m.id = r.menu_item_id WHERE r.id = ?`,
          )
          .get(id)
      : undefined;
    if (!row) return sendError(res, 404, "recipe not found");
    res.json({ ...row, lines: recipeLines(id) });
  });

  // --- stock_items + stock_movements (Task 10: inventory ledger) ---
  // LEDGER RULING (binds Task 10): stock_movements is the ledger and
  // stock_items.qty is the cached balance. POST /api/stock_movements inserts
  // the movement row AND applies its delta to the item qty in the SAME
  // better-sqlite3 transaction, so the two can never diverge. The client
  // never writes qty directly for corrections: "set count" POSTs an
  // adjustment movement with delta = newCount - currentQty (direct PATCH of
  // qty stays allowed by the API, but the client uses movements for every
  // qty change so the audit trail is complete). Recipe auto-deduction on
  // sale is explicitly NOT built (spec non-goal).
  const STOCK_COLS = "id, name, unit, qty, low_threshold, price_cents";
  const MOVEMENT_COLS = "id, stock_item_id, delta, reason, created_at";
  const MOVEMENT_REASONS = new Set(["delivery", "adjustment", "waste"]);

  function isNonNegNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  function stockRow(id) {
    return db
      .prepare(`SELECT ${STOCK_COLS} FROM stock_items WHERE id = ?`)
      .get(id);
  }

  app.get("/api/stock_items", (req, res) => {
    if (req.query.low === "1") {
      return res.json(
        db
          .prepare(
            `SELECT ${STOCK_COLS} FROM stock_items WHERE qty <= low_threshold ORDER BY id`,
          )
          .all(),
      );
    }
    res.json(
      db.prepare(`SELECT ${STOCK_COLS} FROM stock_items ORDER BY id`).all(),
    );
  });

  app.post("/api/stock_items", (req, res) => {
    const { name, unit, qty = 0, low_threshold = 0, price_cents = 0 } =
      req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return sendError(res, 400, "name is required");
    }
    if (typeof unit !== "string") {
      return sendError(res, 400, "unit is required");
    }
    if (!isNonNegNumber(qty)) {
      return sendError(res, 400, "qty must be a non-negative number");
    }
    if (!isNonNegNumber(low_threshold)) {
      return sendError(res, 400, "low_threshold must be a non-negative number");
    }
    if (!isInt(price_cents) || price_cents < 0) {
      return sendError(res, 400, "price_cents must be a non-negative integer");
    }
    const info = db
      .prepare(
        "INSERT INTO stock_items (name, unit, qty, low_threshold, price_cents) VALUES (?, ?, ?, ?, ?)",
      )
      .run(name.trim(), unit, qty, low_threshold, price_cents);
    res.status(201).json(stockRow(info.lastInsertRowid));
  });

  app.get("/api/stock_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id ? stockRow(id) : undefined;
    if (!row) return sendError(res, 404, "stock item not found");
    res.json(row);
  });

  app.patch("/api/stock_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? stockRow(id) : undefined;
    if (!current) return sendError(res, 404, "stock item not found");
    const {
      name = current.name,
      unit = current.unit,
      qty = current.qty,
      low_threshold = current.low_threshold,
      price_cents = current.price_cents,
    } = req.body ?? {};
    if (typeof name !== "string" || name.trim() === "") {
      return sendError(res, 400, "name is required");
    }
    if (typeof unit !== "string") {
      return sendError(res, 400, "unit is required");
    }
    if (!isNonNegNumber(qty)) {
      return sendError(res, 400, "qty must be a non-negative number");
    }
    if (!isNonNegNumber(low_threshold)) {
      return sendError(res, 400, "low_threshold must be a non-negative number");
    }
    if (!isInt(price_cents) || price_cents < 0) {
      return sendError(res, 400, "price_cents must be a non-negative integer");
    }
    db.prepare(
      "UPDATE stock_items SET name = ?, unit = ?, qty = ?, low_threshold = ?, price_cents = ? WHERE id = ?",
    ).run(name.trim(), unit, qty, low_threshold, price_cents, id);
    res.json(stockRow(id));
  });

  app.delete("/api/stock_items/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "stock item not found");
    try {
      const info = db.prepare("DELETE FROM stock_items WHERE id = ?").run(id);
      if (info.changes === 0)
        return sendError(res, 404, "stock item not found");
    } catch (err) {
      if (String(err?.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 400, "stock item has movements");
      }
      throw err;
    }
    res.status(204).end();
  });

  app.post("/api/stock_movements", (req, res) => {
    const { stock_item_id, delta, reason } = req.body ?? {};
    if (!MOVEMENT_REASONS.has(reason)) {
      return sendError(
        res,
        400,
        "reason must be delivery, adjustment, or waste",
      );
    }
    if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) {
      return sendError(res, 400, "delta must be a non-zero number");
    }
    if (!isInt(stock_item_id)) {
      return sendError(res, 400, "stock_item_id must be an integer");
    }
    const item = stockRow(stock_item_id);
    if (!item) return sendError(res, 404, "stock item not found");
    const nextQty = item.qty + delta;
    if (nextQty < 0) {
      return sendError(res, 400, "movement would make qty negative");
    }
    const apply = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO stock_movements (stock_item_id, delta, reason, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(stock_item_id, delta, reason, nowStamp());
      db.prepare("UPDATE stock_items SET qty = ? WHERE id = ?").run(
        nextQty,
        stock_item_id,
      );
      return info.lastInsertRowid;
    });
    res
      .status(201)
      .json(
        db
          .prepare(
            `SELECT ${MOVEMENT_COLS} FROM stock_movements WHERE id = ?`,
          )
          .get(apply()),
      );
  });

  app.get("/api/stock_movements", (req, res) => {
    if (req.query.stock_item_id !== undefined) {
      const stockItemId = Number(req.query.stock_item_id);
      if (!isInt(stockItemId)) {
        return sendError(res, 400, "stock_item_id must be an integer");
      }
      return res.json(
        db
          .prepare(
            `SELECT ${MOVEMENT_COLS} FROM stock_movements WHERE stock_item_id = ? ORDER BY id DESC`,
          )
          .all(stockItemId),
      );
    }
    res.json(
      db
        .prepare(`SELECT ${MOVEMENT_COLS} FROM stock_movements ORDER BY id DESC`)
        .all(),
    );
  });

  // --- bills / expenses / payables (Task 11: finance shell) ---
  // OVERDUE RULING (Task 8 UTC ruling binds here): "today" is the UTC
  // calendar date, i.e. new Date().toISOString().slice(0, 10). A payable is
  // overdue when paid = 0 AND due_date < today-UTC. Plain string comparison
  // is valid because due_date is stored zero-padded as YYYY-MM-DD. Same
  // reasoning as the /api/sales/summary day-boundary ruling above: shop
  // hours 2pm-10pm PHT always fall inside one UTC date.
  function utcToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function isValidDateString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const day = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
    );
  }

  // Shared ?paid=0|1 filter used by the bills and payables collections.
  // Returns {clause, param} or sends a 400 and returns null.
  function paidFilter(query, res) {
    if (query.paid === undefined) return null;
    if (query.paid !== "0" && query.paid !== "1") {
      sendError(res, 400, "paid must be 0 or 1");
      return undefined;
    }
    return { clause: "paid = ?", param: Number(query.paid) };
  }

  function validateMoney(amount_cents) {
    return isInt(amount_cents) && amount_cents >= 0;
  }

  const BILL_COLS = "id, name, amount_cents, due_day, paid";

  function billRow(id) {
    return db.prepare(`SELECT ${BILL_COLS} FROM bills WHERE id = ?`).get(id);
  }

  function validateBillFields({ name, amount_cents, due_day, paid }) {
    if (typeof name !== "string" || name.trim() === "") {
      return "name is required";
    }
    if (!validateMoney(amount_cents)) {
      return "amount_cents must be a non-negative integer";
    }
    if (!isInt(due_day) || due_day < 1 || due_day > 31) {
      return "due_day must be an integer from 1 to 31";
    }
    if (paid !== 0 && paid !== 1) {
      return "paid must be 0 or 1";
    }
    return null;
  }

  app.get("/api/bills", (req, res) => {
    const where = [];
    const params = [];
    const paid = paidFilter(req.query, res);
    if (paid === undefined) return;
    if (paid) {
      where.push(paid.clause);
      params.push(paid.param);
    }
    if (req.query.due_day !== undefined) {
      const dueDay = Number(req.query.due_day);
      if (!isInt(dueDay) || dueDay < 1 || dueDay > 31) {
        return sendError(res, 400, "due_day must be an integer from 1 to 31");
      }
      where.push("due_day = ?");
      params.push(dueDay);
    }
    const rows = db
      .prepare(
        `SELECT ${BILL_COLS} FROM bills${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
      )
      .all(...params);
    res.json(rows);
  });

  app.post("/api/bills", (req, res) => {
    const { name, amount_cents, due_day, paid = 0 } = req.body ?? {};
    const error = validateBillFields({ name, amount_cents, due_day, paid });
    if (error) return sendError(res, 400, error);
    const info = db
      .prepare(
        "INSERT INTO bills (name, amount_cents, due_day, paid) VALUES (?, ?, ?, ?)",
      )
      .run(name.trim(), amount_cents, due_day, paid);
    res.status(201).json(billRow(info.lastInsertRowid));
  });

  app.get("/api/bills/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id ? billRow(id) : undefined;
    if (!row) return sendError(res, 404, "bill not found");
    res.json(row);
  });

  app.patch("/api/bills/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? billRow(id) : undefined;
    if (!current) return sendError(res, 404, "bill not found");
    const {
      name = current.name,
      amount_cents = current.amount_cents,
      due_day = current.due_day,
      paid = current.paid,
    } = req.body ?? {};
    const error = validateBillFields({ name, amount_cents, due_day, paid });
    if (error) return sendError(res, 400, error);
    db.prepare(
      "UPDATE bills SET name = ?, amount_cents = ?, due_day = ?, paid = ? WHERE id = ?",
    ).run(name.trim(), amount_cents, due_day, paid, id);
    res.json(billRow(id));
  });

  app.delete("/api/bills/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "bill not found");
    const info = db.prepare("DELETE FROM bills WHERE id = ?").run(id);
    if (info.changes === 0) return sendError(res, 404, "bill not found");
    res.status(204).end();
  });

  // --- expenses ---
  // No paid flag on this table (money-out records, not to-pay items), so no
  // ?paid filter here; unknown query params are ignored per convention.
  const EXPENSE_COLS = "id, date, category, amount_cents, note";

  function expenseRow(id) {
    return db
      .prepare(`SELECT ${EXPENSE_COLS} FROM expenses WHERE id = ?`)
      .get(id);
  }

  function validateExpenseFields({ date, category, amount_cents, note }) {
    if (!isValidDateString(date)) {
      return "date must be YYYY-MM-DD";
    }
    if (typeof category !== "string" || category.trim() === "") {
      return "category is required";
    }
    if (!validateMoney(amount_cents)) {
      return "amount_cents must be a non-negative integer";
    }
    if (typeof note !== "string") {
      return "note must be a string";
    }
    return null;
  }

  app.get("/api/expenses", (req, res) => {
    res.json(
      db.prepare(`SELECT ${EXPENSE_COLS} FROM expenses ORDER BY id`).all(),
    );
  });

  app.post("/api/expenses", (req, res) => {
    const { date, category, amount_cents, note = "" } = req.body ?? {};
    const error = validateExpenseFields({ date, category, amount_cents, note });
    if (error) return sendError(res, 400, error);
    const info = db
      .prepare(
        "INSERT INTO expenses (date, category, amount_cents, note) VALUES (?, ?, ?, ?)",
      )
      .run(date, category.trim(), amount_cents, note);
    res.status(201).json(expenseRow(info.lastInsertRowid));
  });

  app.get("/api/expenses/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id ? expenseRow(id) : undefined;
    if (!row) return sendError(res, 404, "expense not found");
    res.json(row);
  });

  app.patch("/api/expenses/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? expenseRow(id) : undefined;
    if (!current) return sendError(res, 404, "expense not found");
    const {
      date = current.date,
      category = current.category,
      amount_cents = current.amount_cents,
      note = current.note,
    } = req.body ?? {};
    const error = validateExpenseFields({ date, category, amount_cents, note });
    if (error) return sendError(res, 400, error);
    db.prepare(
      "UPDATE expenses SET date = ?, category = ?, amount_cents = ?, note = ? WHERE id = ?",
    ).run(date, category.trim(), amount_cents, note, id);
    res.json(expenseRow(id));
  });

  app.delete("/api/expenses/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "expense not found");
    const info = db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
    if (info.changes === 0) return sendError(res, 404, "expense not found");
    res.status(204).end();
  });

  // --- payables (to-pay list with due dates; Task 13 consumes ?overdue=1) ---
  const PAYABLE_COLS = "id, label, amount_cents, due_date, paid";

  function payableRow(id) {
    return db
      .prepare(`SELECT ${PAYABLE_COLS} FROM payables WHERE id = ?`)
      .get(id);
  }

  function validatePayableFields({ label, amount_cents, due_date, paid }) {
    if (typeof label !== "string" || label.trim() === "") {
      return "label is required";
    }
    if (!validateMoney(amount_cents)) {
      return "amount_cents must be a non-negative integer";
    }
    if (!isValidDateString(due_date)) {
      return "due_date must be YYYY-MM-DD";
    }
    if (paid !== 0 && paid !== 1) {
      return "paid must be 0 or 1";
    }
    return null;
  }

  app.get("/api/payables", (req, res) => {
    const where = [];
    const params = [];
    const paid = paidFilter(req.query, res);
    if (paid === undefined) return;
    if (paid) {
      where.push(paid.clause);
      params.push(paid.param);
    }
    if (req.query.overdue !== undefined) {
      if (req.query.overdue !== "1") {
        return sendError(res, 400, "overdue must be 1");
      }
      where.push("paid = 0 AND due_date < ?");
      params.push(utcToday());
    }
    if (req.query.due_before !== undefined) {
      const cutoff = String(req.query.due_before);
      if (!isValidDateString(cutoff)) {
        return sendError(res, 400, "due_before must be YYYY-MM-DD");
      }
      where.push("due_date <= ?");
      params.push(cutoff);
    }
    const rows = db
      .prepare(
        `SELECT ${PAYABLE_COLS} FROM payables${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id`,
      )
      .all(...params);
    res.json(rows);
  });

  app.post("/api/payables", (req, res) => {
    const { label, amount_cents, due_date, paid = 0 } = req.body ?? {};
    const error = validatePayableFields({ label, amount_cents, due_date, paid });
    if (error) return sendError(res, 400, error);
    const info = db
      .prepare(
        "INSERT INTO payables (label, amount_cents, due_date, paid) VALUES (?, ?, ?, ?)",
      )
      .run(label.trim(), amount_cents, due_date, paid);
    res.status(201).json(payableRow(info.lastInsertRowid));
  });

  app.get("/api/payables/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id ? payableRow(id) : undefined;
    if (!row) return sendError(res, 404, "payable not found");
    res.json(row);
  });

  app.patch("/api/payables/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? payableRow(id) : undefined;
    if (!current) return sendError(res, 404, "payable not found");
    const {
      label = current.label,
      amount_cents = current.amount_cents,
      due_date = current.due_date,
      paid = current.paid,
    } = req.body ?? {};
    const error = validatePayableFields({
      label,
      amount_cents,
      due_date,
      paid,
    });
    if (error) return sendError(res, 400, error);
    db.prepare(
      "UPDATE payables SET label = ?, amount_cents = ?, due_date = ?, paid = ? WHERE id = ?",
    ).run(label.trim(), amount_cents, due_date, paid, id);
    res.json(payableRow(id));
  });

  app.delete("/api/payables/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "payable not found");
    const info = db.prepare("DELETE FROM payables WHERE id = ?").run(id);
    if (info.changes === 0) return sendError(res, 404, "payable not found");
    res.status(204).end();
  });

  // --- loans (Task 12: money YOU owe; no interest or amortization) ---
  const LOAN_COLS =
    "id, lender, principal_cents, balance_cents, installment_cents, due_day";
  const LOAN_PAYMENT_COLS = "id, loan_id, amount_cents, paid_at";

  function loanRow(id) {
    return db.prepare(`SELECT ${LOAN_COLS} FROM loans WHERE id = ?`).get(id);
  }

  function validateLoanFields({
    lender,
    principal_cents,
    balance_cents,
    installment_cents,
    due_day,
  }) {
    if (typeof lender !== "string" || lender.trim() === "") {
      return "lender is required";
    }
    if (!isInt(principal_cents) || principal_cents < 0) {
      return "principal_cents must be a non-negative integer";
    }
    if (!isInt(balance_cents) || balance_cents < 0) {
      return "balance_cents must be a non-negative integer";
    }
    if (!isInt(installment_cents) || installment_cents <= 0) {
      return "installment_cents must be a positive integer";
    }
    if (!isInt(due_day) || due_day < 1 || due_day > 31) {
      return "due_day must be an integer from 1 to 31";
    }
    return null;
  }

  app.get("/api/loans", (req, res) => {
    if (req.query.outstanding !== undefined) {
      if (req.query.outstanding !== "1") {
        return sendError(res, 400, "outstanding must be 1");
      }
      return res.json(
        db
          .prepare(`SELECT ${LOAN_COLS} FROM loans WHERE balance_cents > 0 ORDER BY id`)
          .all(),
      );
    }
    res.json(db.prepare(`SELECT ${LOAN_COLS} FROM loans ORDER BY id`).all());
  });

  app.post("/api/loans", (req, res) => {
    const { lender, principal_cents, installment_cents, due_day } =
      req.body ?? {};
    // Fresh-loan default: omitted balance starts at the full principal.
    let { balance_cents } = req.body ?? {};
    if (balance_cents === undefined) balance_cents = principal_cents;
    const error = validateLoanFields({
      lender,
      principal_cents,
      balance_cents,
      installment_cents,
      due_day,
    });
    if (error) return sendError(res, 400, error);
    const info = db
      .prepare(
        "INSERT INTO loans (lender, principal_cents, balance_cents, installment_cents, due_day) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        lender.trim(),
        principal_cents,
        balance_cents,
        installment_cents,
        due_day,
      );
    res.status(201).json(loanRow(info.lastInsertRowid));
  });

  app.get("/api/loans/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id ? loanRow(id) : undefined;
    if (!row) return sendError(res, 404, "loan not found");
    res.json(row);
  });

  app.patch("/api/loans/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? loanRow(id) : undefined;
    if (!current) return sendError(res, 404, "loan not found");
    const {
      lender = current.lender,
      principal_cents = current.principal_cents,
      balance_cents = current.balance_cents,
      installment_cents = current.installment_cents,
      due_day = current.due_day,
    } = req.body ?? {};
    const error = validateLoanFields({
      lender,
      principal_cents,
      balance_cents,
      installment_cents,
      due_day,
    });
    if (error) return sendError(res, 400, error);
    db.prepare(
      "UPDATE loans SET lender = ?, principal_cents = ?, balance_cents = ?, installment_cents = ?, due_day = ? WHERE id = ?",
    ).run(
      lender.trim(),
      principal_cents,
      balance_cents,
      installment_cents,
      due_day,
      id,
    );
    res.json(loanRow(id));
  });

  // DELETE RULE (Task 12, verbatim): a loan may be deleted ONLY when
  // balance_cents == 0; otherwise 400. Fully-paid loans carry no further
  // obligation, so the delete also removes their loan_payments history rows
  // (in the same transaction as the loan row) to leave no orphans.
  app.delete("/api/loans/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? loanRow(id) : undefined;
    if (!current) return sendError(res, 404, "loan not found");
    if (current.balance_cents !== 0) {
      return sendError(res, 400, "loan has an outstanding balance");
    }
    const remove = db.transaction(() => {
      db.prepare("DELETE FROM loan_payments WHERE loan_id = ?").run(id);
      db.prepare("DELETE FROM loans WHERE id = ?").run(id);
    });
    remove();
    res.status(204).end();
  });

  // A payment inserts the loan_payments row AND decrements the loan balance
  // in ONE transaction so the ledger and the cached balance never diverge
  // (same ruling shape as the Task 10 stock ledger).
  app.post("/api/loans/:id/payments", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? loanRow(id) : undefined;
    if (!current) return sendError(res, 404, "loan not found");
    const { amount_cents } = req.body ?? {};
    if (!isInt(amount_cents) || amount_cents <= 0) {
      return sendError(res, 400, "amount_cents must be a positive integer");
    }
    if (amount_cents > current.balance_cents) {
      return sendError(res, 400, "payment exceeds outstanding balance");
    }
    const apply = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO loan_payments (loan_id, amount_cents, paid_at) VALUES (?, ?, ?)",
        )
        .run(id, amount_cents, nowStamp());
      db.prepare("UPDATE loans SET balance_cents = ? WHERE id = ?").run(
        current.balance_cents - amount_cents,
        id,
      );
      return info.lastInsertRowid;
    });
    const paymentId = apply();
    res
      .status(201)
      .json({
        payment: db
          .prepare(`SELECT ${LOAN_PAYMENT_COLS} FROM loan_payments WHERE id = ?`)
          .get(paymentId),
        balance_cents: current.balance_cents - amount_cents,
      });
  });

  app.get("/api/loans/:id/payments", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? loanRow(id) : undefined;
    if (!current) return sendError(res, 404, "loan not found");
    res.json(
      db
        .prepare(
          `SELECT ${LOAN_PAYMENT_COLS} FROM loan_payments WHERE loan_id = ? ORDER BY paid_at DESC, id DESC`,
        )
        .all(id),
    );
  });

  // --- dashboard (Task 13: closing-time reconciliation) ---
  // NET RULE (binds Task 13): net_day = income_day.total - expenses_day and
  // net_month = income_month.total - expenses_month. Net covers FLOWS only
  // (POS income minus money-out expenses). STOCKS — unpaid_bills_cents,
  // unpaid_payables_cents, outstanding_loans_cents — are separate memo lines
  // and are NEVER subtracted into net. An unpaid bill is not money out yet.
  // DAY/MONTH RULING (Task 8 binds): sales match on the created_at TEXT
  // prefix YYYY-MM-DD / YYYY-MM; expenses match on the date TEXT prefix.
  // DUES RULING: "today" is the resolved ?date= value (defaults to UTC
  // today). Bills have no full date, so due is the zero-padded due_day
  // ("05"); payables keep their due_date. upcoming_dues holds ALL unpaid
  // bills plus unpaid payables with due_date <= date+7 days (overdues have
  // no lower bound), sorted by due ascending.
  app.get("/api/dashboard", (req, res) => {
    const todayUTC = new Date().toISOString().slice(0, 10);
    const date = req.query.date === undefined ? todayUTC : String(req.query.date);
    const month =
      req.query.month === undefined
        ? todayUTC.slice(0, 7)
        : String(req.query.month);
    if (!isValidDateString(date)) {
      return sendError(res, 400, "date must be YYYY-MM-DD");
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return sendError(res, 400, "month must be YYYY-MM");
    }

    function income(prefix) {
      const row = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN payment = 'cash' AND voided = 0 THEN total_cents ELSE 0 END), 0) AS cash_cents,
             COALESCE(SUM(CASE WHEN payment = 'gcash' AND voided = 0 THEN total_cents ELSE 0 END), 0) AS gcash_cents,
             COALESCE(SUM(CASE WHEN voided = 0 THEN 1 ELSE 0 END), 0) AS count
           FROM sales WHERE created_at LIKE ?`,
        )
        .get(`${prefix}%`);
      return {
        cash_cents: row.cash_cents,
        gcash_cents: row.gcash_cents,
        total_cents: row.cash_cents + row.gcash_cents,
        count: row.count,
      };
    }

    function expenses(prefix) {
      return db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM expenses WHERE date LIKE ?",
        )
        .get(`${prefix}%`).v;
    }

    const incomeDay = income(date);
    const incomeMonth = income(month);
    const expensesDay = expenses(date);
    const expensesMonth = expenses(month);

    const unpaidBills = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM bills WHERE paid = 0",
      )
      .get().v;
    const unpaidPayables = db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM payables WHERE paid = 0",
      )
      .get().v;

    const cutoff = new Date(
      new Date(`${date}T00:00:00Z`).getTime() + 7 * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const upcomingDues = [
      ...db
        .prepare("SELECT name, amount_cents, due_day FROM bills WHERE paid = 0")
        .all()
        .map((bill) => ({
          kind: "bill",
          label: bill.name,
          amount_cents: bill.amount_cents,
          due: String(bill.due_day).padStart(2, "0"),
        })),
      ...db
        .prepare(
          "SELECT label, amount_cents, due_date FROM payables WHERE paid = 0 AND due_date <= ?",
        )
        .all(cutoff)
        .map((payable) => ({
          kind: "payable",
          label: payable.label,
          amount_cents: payable.amount_cents,
          due: payable.due_date,
        })),
    ].sort((a, b) => {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    const loanRows = db
      .prepare(
        "SELECT id, lender, balance_cents FROM loans WHERE balance_cents > 0 ORDER BY id",
      )
      .all();
    const outstandingLoans = loanRows.reduce(
      (sum, row) => sum + row.balance_cents,
      0,
    );

    const bestSellers = db
      .prepare(
        `SELECT si.menu_item_id AS menu_item_id, m.name AS name,
           SUM(si.qty) AS qty,
           SUM(si.qty * si.unit_price_cents) AS revenue_cents
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN menu_items m ON m.id = si.menu_item_id
         WHERE s.created_at LIKE ? AND s.voided = 0
         GROUP BY si.menu_item_id
         ORDER BY qty DESC, revenue_cents DESC
         LIMIT 5`,
      )
      .all(`${month}%`);

    res.json({
      date,
      month,
      income_day: incomeDay,
      income_month: incomeMonth,
      expenses_day_cents: expensesDay,
      expenses_month_cents: expensesMonth,
      net_day_cents: incomeDay.total_cents - expensesDay,
      net_month_cents: incomeMonth.total_cents - expensesMonth,
      unpaid_bills_cents: unpaidBills,
      unpaid_payables_cents: unpaidPayables,
      upcoming_dues: upcomingDues,
      outstanding_loans_cents: outstandingLoans,
      loans: loanRows,
      best_sellers: bestSellers,
    });
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
