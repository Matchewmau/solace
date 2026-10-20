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
import { seedFoodDb, seedMenuDb } from "./db/seed-menu.mjs";
import { seedRecipesDb } from "./db/seed-recipes.mjs";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(SERVER_DIR, "..", "client", "dist");

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

// Shared UTC date helpers: dates are plain YYYY-MM-DD strings so plain
// lexicographic comparison is also chronological comparison.
function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, n) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + n);
  return day.toISOString().slice(0, 10);
}

// Month is 1-based and overflow rolls into following years (13 -> Jan next
// year). The day clamps to that month's last day (Jan 31 -> Feb 28/29).
function clampedDate(year, month, day) {
  const index = month - 1;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}

// This month's clamped due day when it is on/after `from`, else next month's.
function nextDateForDay(dueDay, from = utcToday()) {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const thisMonth = clampedDate(year, month, dueDay);
  return thisMonth >= from ? thisMonth : clampedDate(year, month + 1, dueDay);
}

function addFrequency(date, frequency) {
  if (frequency === "weekly") return addDays(date, 7);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return clampedDate(year, month + 1, day);
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
  // Boot migration: pre-usage Task 5 DBs reject 'used' in the movements CHECK
  // and lack the note column. SQLite cannot alter a CHECK, so rebuild the
  // table once, preserving ids/timestamps and recreating the index after the
  // legacy table (and its index) is dropped.
  const movementCols = db
    .prepare("PRAGMA table_info(stock_movements)")
    .all()
    .map((col) => col.name);
  const movementSql =
    db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'",
      )
      .get()?.sql ?? "";
  if (!movementCols.includes("note") || !movementSql.includes("'used'")) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE stock_movements RENAME TO stock_movements_legacy;
        CREATE TABLE stock_movements (
          id INTEGER PRIMARY KEY,
          stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
          delta REAL NOT NULL,
          reason TEXT NOT NULL CHECK (reason IN ('delivery', 'used', 'adjustment', 'waste')),
          note TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO stock_movements (id, stock_item_id, delta, reason, note, created_at)
          SELECT id, stock_item_id, delta, reason, NULL, created_at
          FROM stock_movements_legacy;
        DROP TABLE stock_movements_legacy;
        CREATE INDEX IF NOT EXISTS idx_stock_movements_stock_item_id
          ON stock_movements(stock_item_id);
      `);
    })();
  }
  const salesCols = db
    .prepare("PRAGMA table_info(sales)")
    .all()
    .map((col) => col.name);
  if (!salesCols.includes("paid")) {
    db.exec("ALTER TABLE sales ADD COLUMN paid INTEGER NOT NULL DEFAULT 0");
  }
  // Cash tender columns (Task 6): pre-change DBs lack received_cents /
  // change_cents. No DEFAULT — old rows stay NULL (unknown tender), and the
  // GCash path likewise leaves them NULL.
  if (!salesCols.includes("received_cents")) {
    db.exec("ALTER TABLE sales ADD COLUMN received_cents INTEGER");
  }
  if (!salesCols.includes("change_cents")) {
    db.exec("ALTER TABLE sales ADD COLUMN change_cents INTEGER");
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
  // Recurring-schedule columns (recurring bills Task 2): old DBs only have
  // due_day. Add due_date nullable first, then backfill from due_day, so
  // CREATE TABLE IF NOT EXISTS never needs a table rebuild. due_day stays as
  // a compatibility mirror; new code reads due_date only.
  const migrationToday = utcToday();
  const billCols = db
    .prepare("PRAGMA table_info(bills)")
    .all()
    .map((col) => col.name);
  if (!billCols.includes("due_date")) {
    db.exec("ALTER TABLE bills ADD COLUMN due_date TEXT");
  }
  // Heal NULL due_date on every boot. ALTER TABLE autocommits, so a crash
  // between it and the backfill would otherwise leave due_date NULL forever:
  // the next boot sees the column and skips a conditional backfill. Only NULL
  // rows are touched, making this idempotent. A malformed NULL due_day falls
  // back to today's day-of-month and is repaired so the mirror stays valid.
  const backfillBills = db.transaction(() => {
    const update = db.prepare(
      "UPDATE bills SET due_date = ?, due_day = ? WHERE id = ?",
    );
    for (const row of db
      .prepare("SELECT id, due_day FROM bills WHERE due_date IS NULL")
      .all()) {
      const dueDay = Number.isInteger(row.due_day)
        ? row.due_day
        : Number(migrationToday.slice(8, 10));
      update.run(nextDateForDay(dueDay, migrationToday), dueDay, row.id);
    }
  });
  backfillBills();
  if (!billCols.includes("frequency")) {
    db.exec("ALTER TABLE bills ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly'");
  }
  if (!billCols.includes("end_date")) {
    db.exec("ALTER TABLE bills ADD COLUMN end_date TEXT");
  }
  if (!billCols.includes("alert_days")) {
    db.exec(
      "ALTER TABLE bills ADD COLUMN alert_days INTEGER NOT NULL DEFAULT 3",
    );
  }
  if (!billCols.includes("series_id")) {
    db.exec("ALTER TABLE bills ADD COLUMN series_id INTEGER");
  }
  if (!billCols.includes("source_bill_id")) {
    db.exec("ALTER TABLE bills ADD COLUMN source_bill_id INTEGER");
  }
  db.exec("UPDATE bills SET series_id = id WHERE series_id IS NULL");
  // Created here (not schema.sql) so legacy DBs get it too.
  db.exec("CREATE INDEX IF NOT EXISTS idx_bills_due_date ON bills(due_date)");
  // Payment-date columns (Task 7): pre-change DBs lack bills.paid_at /
  // payables.paid_at. No DEFAULT — old and unpaid rows stay NULL (never
  // paid), and only a paid 0→1 toggle stamps a time.
  if (!billCols.includes("paid_at")) {
    db.exec("ALTER TABLE bills ADD COLUMN paid_at TEXT");
  }
  const payableCols = db
    .prepare("PRAGMA table_info(payables)")
    .all()
    .map((col) => col.name);
  if (!payableCols.includes("paid_at")) {
    db.exec("ALTER TABLE payables ADD COLUMN paid_at TEXT");
  }
  // Recurring-schedule columns (recurring loans Task 3): old DBs only have
  // due_day. Add due_date nullable first, then backfill from due_day, so
  // CREATE TABLE IF NOT EXISTS never needs a table rebuild. due_day stays as
  // a compatibility mirror; new code reads due_date only.
  const loanCols = db
    .prepare("PRAGMA table_info(loans)")
    .all()
    .map((col) => col.name);
  if (!loanCols.includes("due_date")) {
    db.exec("ALTER TABLE loans ADD COLUMN due_date TEXT");
  }
  // Heal NULL due_date on every boot (same interrupted-first-boot reason as
  // bills above). Only NULL rows are touched, so repeated boots are no-ops.
  const backfillLoans = db.transaction(() => {
    const update = db.prepare(
      "UPDATE loans SET due_date = ?, due_day = ? WHERE id = ?",
    );
    for (const row of db
      .prepare("SELECT id, due_day FROM loans WHERE due_date IS NULL")
      .all()) {
      const dueDay = Number.isInteger(row.due_day)
        ? row.due_day
        : Number(migrationToday.slice(8, 10));
      update.run(nextDateForDay(dueDay, migrationToday), dueDay, row.id);
    }
  });
  backfillLoans();
  if (!loanCols.includes("frequency")) {
    db.exec(
      "ALTER TABLE loans ADD COLUMN frequency TEXT NOT NULL DEFAULT 'monthly'",
    );
  }
  if (!loanCols.includes("end_date")) {
    db.exec("ALTER TABLE loans ADD COLUMN end_date TEXT");
  }
  if (!loanCols.includes("alert_days")) {
    db.exec(
      "ALTER TABLE loans ADD COLUMN alert_days INTEGER NOT NULL DEFAULT 3",
    );
  }
  // Created here (not schema.sql) so legacy DBs get it too.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_loans_due_date ON loans(due_date)",
  );
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
  // Legacy DBs (non-empty menu, no Food category) get the Food menu once
  // via the targeted bootstrap; when Food already exists this is a no-op,
  // so owner edits (prices, active flags, variants) survive every boot.
  if (!db.prepare("SELECT id FROM categories WHERE name = 'Food'").get()) {
    seedFoodDb(db);
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

  app.get("/api/menu_items/:id/sales-totals", (req, res) => {
    const id = parseId(req.params.id);
    const exists = id
      ? db.prepare("SELECT id FROM menu_items WHERE id = ?").get(id)
      : undefined;
    if (!exists) return sendError(res, 404, "menu item not found");
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(si.qty), 0) AS total_qty,
           COALESCE(SUM(si.qty * si.unit_price_cents), 0) AS total_revenue_cents
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE si.menu_item_id = ? AND s.voided = 0`,
      )
      .get(id);
    res.json({
      menu_item_id: id,
      total_qty: row.total_qty,
      total_revenue_cents: row.total_revenue_cents,
    });
  });

  // --- sales ---
  const SALE_COLS =
    "id, total_cents, payment, voided, paid, daily_seq, received_cents, change_cents, created_at";

  function saleWithItems(saleId) {
    const sale = db
      .prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`)
      .get(saleId);
    if (!sale) return undefined;
    sale.items = db
      .prepare(
        `SELECT si.id, si.menu_item_id, m.name AS menu_item_name,
                si.qty, si.unit_price_cents, si.variant
           FROM sale_items si
           LEFT JOIN menu_items m ON m.id = si.menu_item_id
          WHERE si.sale_id = ?
          ORDER BY si.id`,
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

  // Hard-delete an unpaid sale. Paid sales are financially settled and stay
  // in the ledger; deleting one is refused. Items go first inside the same
  // transaction so a failure can never leave orphaned lines.
  app.delete("/api/sales/:id", (req, res) => {
    const id = parseId(req.params.id);
    const sale = id
      ? db.prepare("SELECT id, paid FROM sales WHERE id = ?").get(id)
      : undefined;
    if (!sale) return sendError(res, 404, "sale not found");
    if (sale.paid === 1) {
      return sendError(res, 400, "cannot delete a paid sale");
    }
    db.transaction(() => {
      db.prepare("DELETE FROM sale_items WHERE sale_id = ?").run(id);
      db.prepare("DELETE FROM sales WHERE id = ?").run(id);
    })();
    res.status(204).end();
  });

  // Reversible void/paid flags: {voided?: 0|1, paid?: 0|1}, at least one
  // present. Unvoid (0) restores the sale to totals. paid 1 may also carry
  // received_cents (cash tender): stored with change_cents = received − total.
  // paid 0 clears both tender columns; paid 1 without received_cents (GCash)
  // leaves them as-is.
  app.patch("/api/sales/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db.prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`).get(id)
      : undefined;
    if (!current) return sendError(res, 404, "sale not found");
    const body = req.body ?? {};
    const { voided = current.voided, paid = current.paid } = body;
    const receivedGiven = body.received_cents !== undefined;
    if (body.voided === undefined && body.paid === undefined && !receivedGiven) {
      return sendError(res, 400, "voided must be 0 or 1");
    }
    if (voided !== 0 && voided !== 1) {
      return sendError(res, 400, "voided must be 0 or 1");
    }
    if (paid !== 0 && paid !== 1) {
      return sendError(res, 400, "paid must be 0 or 1");
    }
    if (receivedGiven && paid !== 1) {
      return sendError(res, 400, "received_cents requires paid");
    }
    if (receivedGiven && (!isInt(body.received_cents) || body.received_cents < 0)) {
      return sendError(res, 400, "received_cents must be a non-negative integer");
    }
    if (receivedGiven && body.received_cents < current.total_cents) {
      return sendError(res, 400, "received_cents must cover the total");
    }
    const received =
      paid === 1 && receivedGiven
        ? body.received_cents
        : paid === 0
          ? null
          : current.received_cents;
    const change =
      paid === 1 && receivedGiven
        ? body.received_cents - current.total_cents
        : paid === 0
          ? null
          : current.change_cents;
    db.prepare(
      "UPDATE sales SET voided = ?, paid = ?, received_cents = ?, change_cents = ? WHERE id = ?",
    ).run(voided, paid, received, change, id);
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
    const { items, payment } = req.body ?? {};
    // Payment may ride along on an unpaid edit (Done sends the current
    // method). Paid sales are locked: switching method after settlement
    // would desync received/change accounting, so only the same method
    // passes. Omitting payment keeps the sale's stored method.
    if (payment !== undefined) {
      if (payment !== "cash" && payment !== "gcash") {
        return sendError(res, 400, "payment must be 'cash' or 'gcash'");
      }
      if (current.paid === 1 && payment !== current.payment) {
        return sendError(res, 400, "cannot change payment on a paid sale");
      }
    }
    const nextPayment = payment === undefined ? current.payment : payment;
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
      db.prepare(
        "UPDATE sales SET total_cents = ?, payment = ? WHERE id = ?",
      ).run(total, nextPayment, id);
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

  function recipeById(id) {
    const row = db
      .prepare(
        `SELECT ${RECIPE_COLS} FROM recipes r JOIN menu_items m ON m.id = r.menu_item_id WHERE r.id = ?`,
      )
      .get(id);
    if (!row) return undefined;
    return { ...row, lines: recipeLines(id) };
  }

  function validateRecipeLines(lines) {
    if (lines === undefined) return { lines: [] };
    if (!Array.isArray(lines)) return { error: "lines must be an array" };
    if (lines.length > 20) {
      return { error: "lines must have at most 20 items" };
    }
    const clean = [];
    for (const line of lines) {
      if (typeof line?.ingredient !== "string" || line.ingredient.trim() === "") {
        return { error: "ingredient is required" };
      }
      const qty = line?.qty ?? null;
      if (
        qty !== null &&
        (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0)
      ) {
        return { error: "qty must be a non-negative number or null" };
      }
      const unit = line?.unit ?? null;
      if (unit !== null && typeof unit !== "string") {
        return { error: "unit must be a string or null" };
      }
      clean.push({ ingredient: line.ingredient.trim(), qty, unit });
    }
    return { lines: clean };
  }

  app.post("/api/recipes", (req, res) => {
    const { menu_item_id, steps, lines } = req.body ?? {};
    if (!isInt(menu_item_id)) {
      return sendError(res, 400, "menu_item_id must be an integer");
    }
    const item = db
      .prepare(
        "SELECT mi.id, c.name AS category FROM menu_items mi JOIN categories c ON c.id = mi.category_id WHERE mi.id = ?",
      )
      .get(menu_item_id);
    if (!item) return sendError(res, 400, "unknown menu_item_id");
    if (item.category === "Food") {
      return sendError(res, 400, "food items cannot have guides");
    }
    if (
      db.prepare("SELECT id FROM recipes WHERE menu_item_id = ?").get(menu_item_id)
    ) {
      return sendError(res, 400, "recipe already exists for this menu item");
    }
    if (typeof steps !== "string" || steps.trim() === "") {
      return sendError(res, 400, "steps is required");
    }
    const validated = validateRecipeLines(lines);
    if (validated.error) return sendError(res, 400, validated.error);
    const insert = db.transaction(() => {
      const info = db
        .prepare("INSERT INTO recipes (menu_item_id, steps) VALUES (?, ?)")
        .run(menu_item_id, steps);
      const addLine = db.prepare(
        "INSERT INTO recipe_lines (recipe_id, ingredient, qty, unit) VALUES (?, ?, ?, ?)",
      );
      for (const line of validated.lines) {
        addLine.run(info.lastInsertRowid, line.ingredient, line.qty, line.unit);
      }
      return info.lastInsertRowid;
    });
    res.status(201).json(recipeById(insert()));
  });

  app.patch("/api/recipes/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id
      ? db.prepare("SELECT id, menu_item_id, steps FROM recipes WHERE id = ?").get(id)
      : undefined;
    if (!current) return sendError(res, 404, "recipe not found");
    if (
      req.body?.menu_item_id !== undefined &&
      req.body.menu_item_id !== current.menu_item_id
    ) {
      return sendError(res, 400, "menu_item_id cannot be changed");
    }
    const steps = req.body?.steps ?? current.steps;
    if (typeof steps !== "string" || steps.trim() === "") {
      return sendError(res, 400, "steps is required");
    }
    let nextLines = null;
    if (req.body?.lines !== undefined) {
      const validated = validateRecipeLines(req.body.lines);
      if (validated.error) return sendError(res, 400, validated.error);
      nextLines = validated.lines;
    }
    const update = db.transaction(() => {
      db.prepare("UPDATE recipes SET steps = ? WHERE id = ?").run(steps, id);
      if (nextLines !== null) {
        db.prepare("DELETE FROM recipe_lines WHERE recipe_id = ?").run(id);
        const addLine = db.prepare(
          "INSERT INTO recipe_lines (recipe_id, ingredient, qty, unit) VALUES (?, ?, ?, ?)",
        );
        for (const line of nextLines) {
          addLine.run(id, line.ingredient, line.qty, line.unit);
        }
      }
    });
    update();
    res.json(recipeById(id));
  });

  app.delete("/api/recipes/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "recipe not found");
    const remove = db.transaction(() => {
      db.prepare("DELETE FROM recipe_lines WHERE recipe_id = ?").run(id);
      return db.prepare("DELETE FROM recipes WHERE id = ?").run(id);
    });
    if (remove().changes === 0) return sendError(res, 404, "recipe not found");
    res.status(204).end();
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
  const MOVEMENT_COLS = "id, stock_item_id, delta, reason, note, created_at";
  const MOVEMENT_SELECT = `sm.id, sm.stock_item_id, sm.delta, sm.reason, sm.note,
    sm.created_at, si.name AS item_name, si.unit AS item_unit`;
  const MOVEMENT_REASONS = new Set([
    "delivery",
    "used",
    "adjustment",
    "waste",
  ]);

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
    const { stock_item_id, delta, reason, note = null } = req.body ?? {};
    if (!MOVEMENT_REASONS.has(reason)) {
      return sendError(
        res,
        400,
        "reason must be delivery, used, adjustment, or waste",
      );
    }
    if (typeof delta !== "number" || !Number.isFinite(delta) || delta === 0) {
      return sendError(res, 400, "delta must be a non-zero number");
    }
    if (!isInt(stock_item_id)) {
      return sendError(res, 400, "stock_item_id must be an integer");
    }
    if (note !== null && typeof note !== "string") {
      return sendError(res, 400, "note must be a string");
    }
    const trimmedNote = typeof note === "string" ? note.trim() : null;
    if (trimmedNote !== null && trimmedNote.length > 120) {
      return sendError(res, 400, "note must be 120 characters or fewer");
    }
    const storedNote = trimmedNote === "" ? null : trimmedNote;
    const item = stockRow(stock_item_id);
    if (!item) return sendError(res, 404, "stock item not found");
    const nextQty = item.qty + delta;
    if (nextQty < 0) {
      return sendError(res, 400, "movement would make qty negative");
    }
    const apply = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO stock_movements (stock_item_id, delta, reason, note, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(stock_item_id, delta, reason, storedNote, nowStamp());
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
            `SELECT ${MOVEMENT_SELECT}
             FROM stock_movements sm
             LEFT JOIN stock_items si ON si.id = sm.stock_item_id
             WHERE sm.stock_item_id = ?
             ORDER BY sm.id DESC`,
          )
          .all(stockItemId),
      );
    }
    res.json(
      db
        .prepare(
          `SELECT ${MOVEMENT_SELECT}
           FROM stock_movements sm
           LEFT JOIN stock_items si ON si.id = sm.stock_item_id
           ORDER BY sm.id DESC`,
        )
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

  const BILL_COLS =
    "id, name, amount_cents, due_date, due_day, frequency, end_date, alert_days, paid, paid_at, series_id, source_bill_id";

  function billRow(id) {
    return db.prepare(`SELECT ${BILL_COLS} FROM bills WHERE id = ?`).get(id);
  }

  function validateBillFields({
    name,
    amount_cents,
    due_date,
    frequency,
    end_date,
    alert_days,
    paid,
  }) {
    if (typeof name !== "string" || name.trim() === "") {
      return "name is required";
    }
    if (!validateMoney(amount_cents)) {
      return "amount_cents must be a non-negative integer";
    }
    if (!isValidDateString(due_date)) {
      return "due_date must be YYYY-MM-DD";
    }
    if (frequency !== "weekly" && frequency !== "monthly") {
      return "frequency must be weekly or monthly";
    }
    if (end_date !== null && end_date !== undefined) {
      if (!isValidDateString(end_date)) {
        return "end_date must be YYYY-MM-DD";
      }
      if (end_date < due_date) {
        return "end_date must be on or after due_date";
      }
    }
    if (!isInt(alert_days) || alert_days < 1 || alert_days > 30) {
      return "alert_days must be an integer from 1 to 30";
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
        `SELECT ${BILL_COLS} FROM bills${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY paid ASC, due_date ASC, id ASC`,
      )
      .all(...params);
    res.json(rows);
  });

  app.post("/api/bills", (req, res) => {
    const {
      name,
      amount_cents,
      due_date,
      frequency = "monthly",
      end_date = null,
      alert_days = 3,
      paid = 0,
    } = req.body ?? {};
    const error = validateBillFields({
      name,
      amount_cents,
      due_date,
      frequency,
      end_date,
      alert_days,
      paid,
    });
    if (error) return sendError(res, 400, error);
    const paidAt = paid === 1 ? nowStamp() : null;
    const dueDay = Number(due_date.slice(8, 10));
    const insert = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO bills (name, amount_cents, due_date, due_day, frequency, end_date, alert_days, paid, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          name.trim(),
          amount_cents,
          due_date,
          dueDay,
          frequency,
          end_date,
          alert_days,
          paid,
          paidAt,
        );
      db.prepare("UPDATE bills SET series_id = ? WHERE id = ?").run(
        info.lastInsertRowid,
        info.lastInsertRowid,
      );
      return info.lastInsertRowid;
    });
    res.status(201).json(billRow(insert()));
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
      due_date = current.due_date,
      frequency = current.frequency,
      end_date = current.end_date,
      alert_days = current.alert_days,
      paid = current.paid,
    } = req.body ?? {};
    const error = validateBillFields({
      name,
      amount_cents,
      due_date,
      frequency,
      end_date,
      alert_days,
      paid,
    });
    if (error) return sendError(res, 400, error);
    const dueDay = Number(due_date.slice(8, 10));
    const paidAt =
      paid === 1 ? (current.paid === 1 ? current.paid_at : nowStamp()) : null;
    const update = db.prepare(
      "UPDATE bills SET name = ?, amount_cents = ?, due_date = ?, due_day = ?, frequency = ?, end_date = ?, alert_days = ?, paid = ?, paid_at = ? WHERE id = ?",
    );
    const applyUpdate = (nextPaid) =>
      update.run(
        name.trim(),
        amount_cents,
        due_date,
        dueDay,
        frequency,
        end_date,
        alert_days,
        nextPaid,
        paidAt,
        id,
      );

    if (current.paid === 0 && paid === 1) {
      // Paying a cycle finishes it and spawns the next occurrence unless the
      // inclusive end date has passed or a child already exists.
      const markPaid = db.transaction(() => {
        applyUpdate(1);
        const nextDue = addFrequency(due_date, frequency);
        const child = db
          .prepare("SELECT id FROM bills WHERE source_bill_id = ? LIMIT 1")
          .get(id);
        if (!child && (end_date === null || nextDue <= end_date)) {
          db.prepare(
            "INSERT INTO bills (name, amount_cents, due_date, due_day, frequency, end_date, alert_days, paid, paid_at, series_id, source_bill_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)",
          ).run(
            name.trim(),
            amount_cents,
            nextDue,
            Number(nextDue.slice(8, 10)),
            frequency,
            end_date,
            alert_days,
            current.series_id ?? current.id,
            id,
          );
        }
      });
      markPaid();
    } else if (current.paid === 1 && paid === 0) {
      const child = db
        .prepare(
          "SELECT id, paid FROM bills WHERE source_bill_id = ? ORDER BY id LIMIT 1",
        )
        .get(id);
      if (child && child.paid === 1) {
        return sendError(res, 400, "cannot unpay after the next cycle is paid");
      }
      const unpay = db.transaction(() => {
        if (child) {
          db.prepare("DELETE FROM bills WHERE id = ?").run(child.id);
        }
        applyUpdate(0);
      });
      unpay();
    } else {
      // No paid transition: schedule edits only; paid_at is kept as-is.
      applyUpdate(paid);
    }
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
  const PAYABLE_COLS = "id, label, amount_cents, due_date, paid, paid_at";

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
    const paidAt = paid === 1 ? nowStamp() : null;
    const info = db
      .prepare(
        "INSERT INTO payables (label, amount_cents, due_date, paid, paid_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(label.trim(), amount_cents, due_date, paid, paidAt);
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
    const paidAt =
      paid === 1 ? (current.paid === 1 ? current.paid_at : nowStamp()) : null;
    db.prepare(
      "UPDATE payables SET label = ?, amount_cents = ?, due_date = ?, paid = ?, paid_at = ? WHERE id = ?",
    ).run(label.trim(), amount_cents, due_date, paid, paidAt, id);
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
    "id, lender, principal_cents, balance_cents, installment_cents, due_date, due_day, frequency, end_date, alert_days";
  const LOAN_PAYMENT_COLS = "id, loan_id, amount_cents, paid_at";

  function loanRow(id) {
    return db.prepare(`SELECT ${LOAN_COLS} FROM loans WHERE id = ?`).get(id);
  }

  // Legacy clients (pre-recurring) send due_day only; derive the canonical
  // due_date from it so they keep working. New clients send due_date, which
  // always wins and derives due_day.
  function resolveLoanDueDate(dueDate, dueDay) {
    if (dueDate !== undefined && dueDate !== null) return dueDate;
    if (isInt(dueDay) && dueDay >= 1 && dueDay <= 31) {
      return nextDateForDay(dueDay);
    }
    return undefined;
  }

  function validateLoanFields({
    lender,
    principal_cents,
    balance_cents,
    installment_cents,
    due_date,
    frequency,
    end_date,
    alert_days,
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
    if (!isValidDateString(due_date)) {
      return "due_date must be YYYY-MM-DD";
    }
    if (frequency !== "weekly" && frequency !== "monthly") {
      return "frequency must be weekly or monthly";
    }
    if (end_date !== null && end_date !== undefined) {
      if (!isValidDateString(end_date)) {
        return "end_date must be YYYY-MM-DD";
      }
      if (end_date < due_date) {
        return "end_date must be on or after due_date";
      }
    }
    if (!isInt(alert_days) || alert_days < 1 || alert_days > 30) {
      return "alert_days must be an integer from 1 to 30";
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
    const {
      lender,
      principal_cents,
      installment_cents,
      due_date: rawDueDate,
      due_day: rawDueDay,
      frequency = "monthly",
      end_date = null,
      alert_days = 3,
    } = req.body ?? {};
    // Fresh-loan default: omitted balance starts at the full principal.
    let { balance_cents } = req.body ?? {};
    if (balance_cents === undefined) balance_cents = principal_cents;
    const due_date = resolveLoanDueDate(rawDueDate, rawDueDay);
    const error = validateLoanFields({
      lender,
      principal_cents,
      balance_cents,
      installment_cents,
      due_date,
      frequency,
      end_date,
      alert_days,
    });
    if (error) return sendError(res, 400, error);
    const dueDay = Number(due_date.slice(8, 10));
    const info = db
      .prepare(
        "INSERT INTO loans (lender, principal_cents, balance_cents, installment_cents, due_date, due_day, frequency, end_date, alert_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        lender.trim(),
        principal_cents,
        balance_cents,
        installment_cents,
        due_date,
        dueDay,
        frequency,
        end_date,
        alert_days,
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
    const body = req.body ?? {};
    const {
      lender = current.lender,
      principal_cents = current.principal_cents,
      balance_cents = current.balance_cents,
      installment_cents = current.installment_cents,
      frequency = current.frequency,
      end_date = current.end_date,
      alert_days = current.alert_days,
    } = body;
    // due_date wins; due_day is the legacy input; otherwise keep current.
    const due_date =
      body.due_date !== undefined && body.due_date !== null
        ? body.due_date
        : body.due_day !== undefined && body.due_day !== null
          ? resolveLoanDueDate(undefined, body.due_day)
          : current.due_date;
    const error = validateLoanFields({
      lender,
      principal_cents,
      balance_cents,
      installment_cents,
      due_date,
      frequency,
      end_date,
      alert_days,
    });
    if (error) return sendError(res, 400, error);
    const dueDay = Number(due_date.slice(8, 10));
    db.prepare(
      "UPDATE loans SET lender = ?, principal_cents = ?, balance_cents = ?, installment_cents = ?, due_date = ?, due_day = ?, frequency = ?, end_date = ?, alert_days = ? WHERE id = ?",
    ).run(
      lender.trim(),
      principal_cents,
      balance_cents,
      installment_cents,
      due_date,
      dueDay,
      frequency,
      end_date,
      alert_days,
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
    const newBalance = current.balance_cents - amount_cents;
    const apply = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO loan_payments (loan_id, amount_cents, paid_at) VALUES (?, ?, ?)",
        )
        .run(id, amount_cents, nowStamp());
      // While the balance remains, roll the due date one cycle forward. The
      // end date is inclusive: the next date may land exactly on it, never
      // past it. A payoff (balance 0) leaves the due date where it was.
      let dueDate = current.due_date;
      if (newBalance > 0) {
        const nextDue = addFrequency(current.due_date, current.frequency);
        if (current.end_date === null || nextDue <= current.end_date) {
          dueDate = nextDue;
        }
      }
      db.prepare(
        "UPDATE loans SET balance_cents = ?, due_date = ?, due_day = ? WHERE id = ?",
      ).run(newBalance, dueDate, Number(dueDate.slice(8, 10)), id);
      return { paymentId: info.lastInsertRowid, dueDate };
    });
    const { paymentId, dueDate } = apply();
    res.status(201).json({
      payment: db
        .prepare(`SELECT ${LOAN_PAYMENT_COLS} FROM loan_payments WHERE id = ?`)
        .get(paymentId),
      balance_cents: newBalance,
      due_date: dueDate,
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

  // --- salaries (Task 5: paid salary ledger; paid_at is server-stamped) ---
  const SALARY_COLS = "id, name, amount_cents, note, paid_at";

  function salaryRow(id) {
    return db
      .prepare(`SELECT ${SALARY_COLS} FROM salaries WHERE id = ?`)
      .get(id);
  }

  function validateSalaryFields({ name, amount_cents, note }) {
    if (typeof name !== "string" || name.trim() === "") {
      return "name is required";
    }
    if (!validateMoney(amount_cents)) {
      return "amount_cents must be a non-negative integer";
    }
    if (typeof note !== "string") {
      return "note must be a string";
    }
    return null;
  }

  app.get("/api/salaries", (req, res) => {
    res.json(
      db.prepare(`SELECT ${SALARY_COLS} FROM salaries ORDER BY id DESC`).all(),
    );
  });

  app.post("/api/salaries", (req, res) => {
    // No date input: every logged salary is stamped at insert time (UTC).
    const { name, amount_cents, note = "" } = req.body ?? {};
    const error = validateSalaryFields({ name, amount_cents, note });
    if (error) return sendError(res, 400, error);
    const info = db
      .prepare(
        "INSERT INTO salaries (name, amount_cents, note, paid_at) VALUES (?, ?, ?, ?)",
      )
      .run(name.trim(), amount_cents, note, nowStamp());
    res.status(201).json(salaryRow(info.lastInsertRowid));
  });

  app.get("/api/salaries/:id", (req, res) => {
    const id = parseId(req.params.id);
    const row = id ? salaryRow(id) : undefined;
    if (!row) return sendError(res, 404, "salary not found");
    res.json(row);
  });

  app.patch("/api/salaries/:id", (req, res) => {
    const id = parseId(req.params.id);
    const current = id ? salaryRow(id) : undefined;
    if (!current) return sendError(res, 404, "salary not found");
    const {
      name = current.name,
      amount_cents = current.amount_cents,
      note = current.note,
    } = req.body ?? {};
    const error = validateSalaryFields({ name, amount_cents, note });
    if (error) return sendError(res, 400, error);
    db.prepare(
      "UPDATE salaries SET name = ?, amount_cents = ?, note = ? WHERE id = ?",
    ).run(name.trim(), amount_cents, note, id);
    res.json(salaryRow(id));
  });

  app.delete("/api/salaries/:id", (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 404, "salary not found");
    const info = db.prepare("DELETE FROM salaries WHERE id = ?").run(id);
    if (info.changes === 0) return sendError(res, 404, "salary not found");
    res.status(204).end();
  });

  // --- due alerts (Task 4: read-only collector for the global bar) ---
  // Windows are per-item for bills and loans; payables use a fixed 3-day
  // window. Overdue items are included regardless of lead time, and the key
  // carries due_date so each recurring cycle re-alerts after dismissal.
  function collectDueAlerts(date) {
    const todayMs = Date.parse(`${date}T00:00:00Z`);
    const daysUntil = (dueDate) =>
      Math.round((Date.parse(`${dueDate}T00:00:00Z`) - todayMs) / 86400000);
    const alerts = [];

    for (const bill of db
      .prepare(
        "SELECT id, name, amount_cents, due_date, alert_days FROM bills WHERE paid = 0",
      )
      .all()) {
      const days_until = daysUntil(bill.due_date);
      if (days_until <= bill.alert_days || days_until < 0) {
        alerts.push({
          key: `bill:${bill.id}:${bill.due_date}`,
          kind: "bill",
          id: bill.id,
          label: bill.name,
          amount_cents: bill.amount_cents,
          due_date: bill.due_date,
          days_until,
          overdue: days_until < 0,
          alert_days: bill.alert_days,
        });
      }
    }

    for (const loan of db
      .prepare(
        "SELECT id, lender, installment_cents, due_date, alert_days FROM loans WHERE balance_cents > 0",
      )
      .all()) {
      const days_until = daysUntil(loan.due_date);
      if (days_until <= loan.alert_days || days_until < 0) {
        alerts.push({
          key: `loan:${loan.id}:${loan.due_date}`,
          kind: "loan",
          id: loan.id,
          label: loan.lender,
          amount_cents: loan.installment_cents,
          due_date: loan.due_date,
          days_until,
          overdue: days_until < 0,
          alert_days: loan.alert_days,
        });
      }
    }

    for (const payable of db
      .prepare(
        "SELECT id, label, amount_cents, due_date FROM payables WHERE paid = 0",
      )
      .all()) {
      const days_until = daysUntil(payable.due_date);
      if (days_until <= 3 || days_until < 0) {
        alerts.push({
          key: `payable:${payable.id}:${payable.due_date}`,
          kind: "payable",
          id: payable.id,
          label: payable.label,
          amount_cents: payable.amount_cents,
          due_date: payable.due_date,
          days_until,
          overdue: days_until < 0,
          alert_days: 3,
        });
      }
    }

    alerts.sort((a, b) => {
      if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      return 0;
    });
    return alerts;
  }

  app.get("/api/due-alerts", (req, res) => {
    const date =
      req.query.date === undefined ? utcToday() : String(req.query.date);
    if (!isValidDateString(date)) {
      return sendError(res, 400, "date must be YYYY-MM-DD");
    }
    res.json({ date, alerts: collectDueAlerts(date) });
  });

  // --- dashboard (Task 13: closing-time reconciliation; Task 8 money-out) ---
  // NET RULES (recurring-dues Task 10, spec §2): net_day =
  // income_day.total - expenses_day. Day net is today's sales minus today's
  // expenses ONLY: salaries and paid bills/payables/loans never reduce it.
  // net_month = income_month.total - money_out_month, where money-out is
  // PAYMENTS-BASED: expenses (date prefix) + paid bills (paid_at prefix) +
  // paid payables (paid_at prefix) + loan payments (paid_at prefix) +
  // salaries (paid_at prefix, counted exactly once and never as an expense).
  // STOCKS — unpaid_bills_cents, unpaid_payables_cents,
  // outstanding_loans_cents — are separate memo lines and are NEVER
  // subtracted into net. An unpaid bill is not money out yet; legacy paid
  // rows with NULL paid_at never count.
  // DAY/MONTH RULING (Task 8 binds): sales match on the created_at TEXT
  // prefix YYYY-MM-DD / YYYY-MM; expenses match on the date TEXT prefix.
  // DUES RULING: "today" is the resolved ?date= value (defaults to UTC
  // today). upcoming_dues holds ALL unpaid bills plus unpaid payables and
  // outstanding loans (balance_cents > 0) with due_date <= date+7 days
  // (overdues have no lower bound). Bills show the zero-padded day-of-month
  // from due_date ("05"); payables and loans show the full due_date.
  // days_until is the UTC calendar difference from the resolved date (0 =
  // today, negative = overdue); overdue is true exactly when due_date <
  // date, for every kind. Sorted by due_date, then label.
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

    // Paid rows only: bills/payables are money out on their paid_at date,
    // NOT on the (due-based) dates above. Legacy paid=1/NULL paid_at rows
    // never match a LIKE prefix, so they stay out of every bucket.
    function paidOut(table, prefix) {
      return db
        .prepare(
          `SELECT COALESCE(SUM(amount_cents), 0) AS v FROM ${table} WHERE paid = 1 AND paid_at LIKE ?`,
        )
        .get(`${prefix}%`).v;
    }

    function loanPayments(prefix) {
      return db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM loan_payments WHERE paid_at LIKE ?",
        )
        .get(`${prefix}%`).v;
    }

    // Salaries are server-stamped paid_at rows (no user date field), so the
    // same paid_at prefix rule applies.
    function salaries(prefix) {
      return db
        .prepare(
          "SELECT COALESCE(SUM(amount_cents), 0) AS v FROM salaries WHERE paid_at LIKE ?",
        )
        .get(`${prefix}%`).v;
    }

    const incomeDay = income(date);
    const incomeMonth = income(month);
    const expensesDay = expenses(date);
    const expensesMonth = expenses(month);

    const moneyOutMonthByKind = {
      bills_cents: paidOut("bills", month),
      expenses_cents: expensesMonth,
      payables_cents: paidOut("payables", month),
      loans_cents: loanPayments(month),
      salaries_cents: salaries(month),
    };
    const moneyOutMonth = Object.values(moneyOutMonthByKind).reduce(
      (sum, cents) => sum + cents,
      0,
    );

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

    const unpaidBillsCount = db
      .prepare("SELECT COUNT(*) AS v FROM bills WHERE paid = 0")
      .get().v;
    const unpaidPayablesCount = db
      .prepare("SELECT COUNT(*) AS v FROM payables WHERE paid = 0")
      .get().v;
    const overduePayablesCount = db
      .prepare(
        "SELECT COUNT(*) AS v FROM payables WHERE paid = 0 AND due_date < ?",
      )
      .get(date).v;
    const expensesMonthCount = db
      .prepare("SELECT COUNT(*) AS v FROM expenses WHERE date LIKE ?")
      .get(`${month}%`).v;
    const salariesMonthCount = db
      .prepare("SELECT COUNT(*) AS v FROM salaries WHERE paid_at LIKE ?")
      .get(`${month}%`).v;

    const cutoff = addDays(date, 7);
    const dateMs = Date.parse(`${date}T00:00:00Z`);
    const daysUntil = (dueDate) =>
      Math.round((Date.parse(`${dueDate}T00:00:00Z`) - dateMs) / 86400000);
    const upcomingDues = [
      ...db
        .prepare(
          "SELECT name, amount_cents, due_date FROM bills WHERE paid = 0",
        )
        .all()
        .map((bill) => ({
          kind: "bill",
          label: bill.name,
          amount_cents: bill.amount_cents,
          due: bill.due_date,
          overdue: bill.due_date < date,
          days_until: daysUntil(bill.due_date),
          due_date: bill.due_date,
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
          overdue: payable.due_date < date,
          days_until: daysUntil(payable.due_date),
          due_date: payable.due_date,
        })),
      ...db
        .prepare(
          "SELECT lender, installment_cents, due_date FROM loans WHERE balance_cents > 0 AND due_date <= ?",
        )
        .all(cutoff)
        .map((loan) => ({
          kind: "loan",
          label: loan.lender,
          amount_cents: loan.installment_cents,
          due: loan.due_date,
          overdue: loan.due_date < date,
          days_until: daysUntil(loan.due_date),
          due_date: loan.due_date,
        })),
    ]
      .sort((a, b) => {
        if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
        if (a.label !== b.label) return a.label < b.label ? -1 : 1;
        return 0;
      })
      .map((due) => ({
        kind: due.kind,
        label: due.label,
        amount_cents: due.amount_cents,
        due: due.due,
        overdue: due.overdue,
        days_until: due.days_until,
      }));

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

    // 31 day-buckets oldest→newest ending at the resolved date, zero-filled.
    // The dashboard slices this window into Today / Week / Month views.
    // One GROUP BY query; substr keeps the created_at TEXT-prefix day rule,
    // and voided = 0 keeps voided sales out of every bucket.
    const salesWindowStart = new Date(
      new Date(`${date}T00:00:00Z`).getTime() - 30 * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const salesTotals = new Map(
      db
        .prepare(
          `SELECT substr(created_at, 1, 10) AS day,
             COALESCE(SUM(total_cents), 0) AS total_cents
           FROM sales
           WHERE voided = 0 AND substr(created_at, 1, 10) BETWEEN ? AND ?
           GROUP BY day`,
        )
        .all(salesWindowStart, date)
        .map((row) => [row.day, row.total_cents]),
    );
    const salesByDay = [];
    for (let offset = 30; offset >= 0; offset -= 1) {
      const day = new Date(
        new Date(`${date}T00:00:00Z`).getTime() - offset * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      salesByDay.push({ date: day, total_cents: salesTotals.get(day) ?? 0 });
    }

    res.json({
      date,
      month,
      income_day: incomeDay,
      income_month: incomeMonth,
      expenses_day_cents: expensesDay,
      expenses_month_cents: expensesMonth,
      expenses_month_count: expensesMonthCount,
      salaries_month_cents: moneyOutMonthByKind.salaries_cents,
      salaries_month_count: salariesMonthCount,
      money_out_month_cents: moneyOutMonth,
      money_out_month_by_kind: moneyOutMonthByKind,
      net_day_cents: incomeDay.total_cents - expensesDay,
      net_month_cents: incomeMonth.total_cents - moneyOutMonth,
      unpaid_bills_cents: unpaidBills,
      unpaid_bills_count: unpaidBillsCount,
      unpaid_payables_cents: unpaidPayables,
      unpaid_payables_count: unpaidPayablesCount,
      overdue_payables_count: overduePayablesCount,
      upcoming_dues: upcomingDues,
      sales_by_day: salesByDay,
      outstanding_loans_cents: outstandingLoans,
      outstanding_loans_count: loanRows.length,
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
