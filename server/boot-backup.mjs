// Boot-time backup check (Task 15): reuse Task 4's runBackup, never duplicate it.
// On server boot (after DB open): if no solace-YYYYMMDD-*.db from TODAY exists
// in the backup dir, run one backup in the background (never blocks listen).
// Plus a 24 h setInterval re-check while running (harmless; shop hours are
// shorter than 24 h). Task 4's CLI + OS-scheduler docs remain the off-hours
// path; server README notes both.
import { existsSync, readdirSync } from "node:fs";
import { runBackup } from "./db/backup.mjs";

function pad(n) {
  return String(n).padStart(2, "0");
}

// Local-day stamp YYYYMMDD matching backup.mjs timestampLocal's date half
// (backup filenames are local time, so the "today" check must be local too).
export function localDayPrefix(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export function hasTodayBackup(backupDir, day = localDayPrefix()) {
  let files;
  try {
    files = readdirSync(backupDir);
  } catch {
    return false;
  }
  return files.some(
    (f) => new RegExp(`^solace-${day}-\\d{6}\\.db$`).test(f),
  );
}

// Runs a backup only when today's is missing. Returns
// { skipped: true } or { skipped: false, path }. Test seam: pass `day` to
// inject "today" without waiting 24 h.
export async function ensureTodayBackup({ dbPath, backupDir, keep = 14, day }) {
  const today = day ?? localDayPrefix();
  if (hasTodayBackup(backupDir, today)) {
    return { skipped: true };
  }
  const created = await runBackup(dbPath, backupDir, keep);
  return { skipped: false, path: created };
}

export function backupDirFromEnv() {
  return process.env.SOLACE_BACKUP_DIR || "server/backups";
}

export function backupKeepFromEnv() {
  const n = Number(process.env.SOLACE_BACKUP_KEEP);
  return Number.isInteger(n) && n >= 1 ? n : 14;
}
