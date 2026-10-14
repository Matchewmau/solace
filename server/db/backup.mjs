// Daily backup routine: timestamped SQLite online-backup copy + restore check.
// Usage:
//   node server/db/backup.mjs [db-path] [backup-dir] [--keep N]
//   node server/db/backup.mjs --verify <backup-path>
// Defaults: db SOLACE_DB env or server/data/solace.db; dir server/backups/
// (both CWD-relative). Invoked manually, by OS scheduler, or by the server's
// once-per-day boot check. Offline only: no network calls.
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_TABLES = [
  "categories",
  "menu_items",
  "sales",
  "sale_items",
  "stock_items",
  "stock_movements",
  "recipes",
  "recipe_lines",
  "expenses",
  "bills",
  "payables",
  "loans",
  "loan_payments",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

export function timestampLocal(d = new Date()) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// Online backup via better-sqlite3 (safe while the server is running).
// Returns the absolute path of the created file.
export async function runBackup(dbPath, backupDir, keep = 14) {
  const src = resolve(dbPath);
  if (!existsSync(src)) {
    throw new Error(`database not found: ${src}`);
  }
  const dir = resolve(backupDir);
  mkdirSync(dir, { recursive: true });

  // Bump the clock by whole seconds on same-second collisions so the
  // solace-YYYYMMDD-HHMMSS.db pattern always holds and is unique.
  let dest = null;
  for (let bump = 0; bump < 120; bump += 1) {
    const stamp = timestampLocal(new Date(Date.now() + bump * 1000));
    const candidate = join(dir, `solace-${stamp}.db`);
    if (!existsSync(candidate)) {
      dest = candidate;
      break;
    }
  }
  if (!dest) {
    throw new Error(`could not pick a unique backup name in ${dir}`);
  }

  const db = new Database(src, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  pruneBackups(dir, keep);
  return dest;
}

export function pruneBackups(backupDir, keep = 14) {
  const dir = resolve(backupDir);
  const files = readdirSync(dir)
    .filter((f) => /^solace-\d{8}-\d{6}\.db$/.test(f))
    .sort();
  const excess = files.slice(0, Math.max(0, files.length - keep));
  for (const f of excess) {
    rmSync(join(dir, f));
  }
  return files.slice(Math.max(0, files.length - keep));
}

// Restore check: read-only open, integrity_check must be ok, all 13 tables
// must exist. Returns { path, integrity, tables, counts }. Throws otherwise.
export function verifyBackup(backupPath) {
  const target = resolve(backupPath);
  if (!existsSync(target)) {
    throw new Error(`backup not found: ${target}`);
  }
  const db = new Database(target, { readonly: true });
  try {
    const row = db.prepare("PRAGMA integrity_check").get();
    const integrity = row?.integrity_check;
    if (integrity !== "ok") {
      throw new Error(`integrity_check failed: ${integrity}`);
    }
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      throw new Error(`missing tables: ${missing.join(", ")}`);
    }
    const counts = {};
    for (const t of EXPECTED_TABLES) {
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    }
    return { path: target, integrity, tables, counts };
  } finally {
    db.close();
  }
}

// CLI defaults: explicit positionals win, then SOLACE_* env, then builtins.
// Exported for tests (the `invokedAsCli` block below delegates to it).
export function resolveCliDefaults(positionals = [], keepOverride = null) {
  const envKeep = Number(process.env.SOLACE_BACKUP_KEEP);
  const envKeepValid =
    Number.isInteger(envKeep) && envKeep >= 1 ? envKeep : 14;
  return {
    dbPath:
      positionals[0] ?? process.env.SOLACE_DB ?? join("server", "data", "solace.db"),
    backupDir:
      positionals[1] ?? process.env.SOLACE_BACKUP_DIR ?? join("server", "backups"),
    keep: keepOverride ?? envKeepValid,
  };
}

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

const invokedAsCli =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsCli) {
  const raw = process.argv.slice(2);
  let keepOverride = null;
  let verifyTarget = null;
  const positionals = [];
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (arg === "--keep") {
      const n = Number(raw[i + 1]);
      if (!Number.isInteger(n) || n < 1) {
        fail("--keep requires a positive integer");
      }
      keepOverride = n;
      i += 1;
    } else if (arg.startsWith("--keep=")) {
      const n = Number(arg.slice("--keep=".length));
      if (!Number.isInteger(n) || n < 1) {
        fail("--keep requires a positive integer");
      }
      keepOverride = n;
    } else if (arg === "--verify") {
      verifyTarget = raw[i + 1];
      if (!verifyTarget) {
        fail("--verify requires a backup path");
      }
      i += 1;
    } else if (arg.startsWith("--verify=")) {
      verifyTarget = arg.slice("--verify=".length);
    } else {
      positionals.push(arg);
    }
  }

  if (verifyTarget) {
    try {
      const result = verifyBackup(verifyTarget);
      console.log(`verified ${result.path}`);
      console.log(`integrity_check: ${result.integrity}`);
      for (const t of EXPECTED_TABLES) {
        console.log(`${t}: ${result.counts[t]}`);
      }
    } catch (err) {
      fail(err.message);
    }
  } else {
    const { dbPath, backupDir, keep } = resolveCliDefaults(positionals, keepOverride);
    try {
      const created = await runBackup(dbPath, backupDir, keep);
      console.log(created);
    } catch (err) {
      fail(err.message);
    }
  }
}
