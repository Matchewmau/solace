import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runBackup, verifyBackup, EXPECTED_TABLES, resolveCliDefaults } from "./backup.mjs";
import { seedDb } from "./seed.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-backup-test-"));
const dbPath = join(dir, "src.db");
const backupDir = join(dir, "backups");
const seedHandle = seedDb(dbPath);
seedHandle.close();

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("backup routine", () => {
  it("creates a timestamped file matching solace-YYYYMMDD-HHMMSS.db", async () => {
    const created = await runBackup(dbPath, backupDir);
    expect(created).toMatch(/solace-\d{8}-\d{6}\.db$/);
    expect(readdirSync(backupDir).some((f) => f.match(/^solace-\d{8}-\d{6}\.db$/))).toBe(true);
  });

  it("verify passes: integrity ok and all 14 tables present with counts", async () => {
    const created = await runBackup(dbPath, backupDir);
    const result = await verifyBackup(created);
    expect(result.integrity).toBe("ok");
    expect([...result.tables].sort()).toEqual([...EXPECTED_TABLES].sort());
    for (const table of EXPECTED_TABLES) {
      expect(result.counts[table], `table ${table} should be non-empty`).toBeGreaterThan(0);
    }
  });

  it("--keep prunes older solace-*.db files to N newest", async () => {
    const keepDir = join(dir, "keep-backups");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(keepDir, { recursive: true });
    // Plant 4 fake older backups plus one real backup.
    for (const stamp of ["20200101-000001", "20200102-000002", "20200103-000003", "20200104-000004"]) {
      writeFileSync(join(keepDir, `solace-${stamp}.db`), "old");
    }
    const created = await runBackup(dbPath, keepDir, 2);
    const remaining = readdirSync(keepDir)
      .filter((f) => f.startsWith("solace-") && f.endsWith(".db"))
      .sort();
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain(created.split(/[\\/]/).pop());
  });
});

describe("CLI env defaults (SOLACE_BACKUP_DIR / SOLACE_BACKUP_KEEP)", () => {
  it("falls back to env when positionals/flags are absent; explicit wins", () => {
    const savedDir = process.env.SOLACE_BACKUP_DIR;
    const savedKeep = process.env.SOLACE_BACKUP_KEEP;
    const savedDb = process.env.SOLACE_DB;
    try {
      delete process.env.SOLACE_BACKUP_DIR;
      delete process.env.SOLACE_BACKUP_KEEP;
      delete process.env.SOLACE_DB;
      expect(resolveCliDefaults([], null)).toMatchObject({
        backupDir: join("server", "backups"),
        keep: 14,
      });
      process.env.SOLACE_BACKUP_DIR = join("custom", "dir");
      process.env.SOLACE_BACKUP_KEEP = "7";
      const fromEnv = resolveCliDefaults([], null);
      expect(fromEnv.backupDir).toBe(join("custom", "dir"));
      expect(fromEnv.keep).toBe(7);
      const explicit = resolveCliDefaults(["db.db", "pos-dir"], 3);
      expect(explicit).toMatchObject({
        dbPath: "db.db",
        backupDir: "pos-dir",
        keep: 3,
      });
    } finally {
      if (savedDir === undefined) delete process.env.SOLACE_BACKUP_DIR;
      else process.env.SOLACE_BACKUP_DIR = savedDir;
      if (savedKeep === undefined) delete process.env.SOLACE_BACKUP_KEEP;
      else process.env.SOLACE_BACKUP_KEEP = savedKeep;
      if (savedDb === undefined) delete process.env.SOLACE_DB;
      else process.env.SOLACE_DB = savedDb;
    }
  });
});
