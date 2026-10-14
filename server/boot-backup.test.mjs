import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ensureTodayBackup,
  hasTodayBackup,
  localDayPrefix,
} from "./boot-backup.mjs";
import { seedDb } from "./db/seed.mjs";

const dir = mkdtempSync(join(tmpdir(), "solace-boot-backup-"));
const dbPath = join(dir, "src.db");
seedDb(dbPath).close();

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("boot backup check", () => {
  it("creates today's backup when missing, skips when present (no dup)", async () => {
    const backupDir = join(dir, "backups");
    expect(hasTodayBackup(backupDir)).toBe(false);

    const first = await ensureTodayBackup({ dbPath, backupDir });
    expect(first.skipped).toBe(false);
    expect(first.path).toMatch(/solace-\d{8}-\d{6}\.db$/);
    expect(hasTodayBackup(backupDir)).toBe(true);

    const before = readdirSync(backupDir).sort();
    const second = await ensureTodayBackup({ dbPath, backupDir });
    expect(second.skipped).toBe(true);
    expect(readdirSync(backupDir).sort()).toEqual(before);
  });

  it("a backup from another day does not count as today's", async () => {
    const backupDir = join(dir, "other-day");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(backupDir, "solace-20000101-000000.db"), "old");
    expect(hasTodayBackup(backupDir, localDayPrefix())).toBe(false);
    const result = await ensureTodayBackup({ dbPath, backupDir });
    expect(result.skipped).toBe(false);
  });
});
