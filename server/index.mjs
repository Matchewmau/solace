// Entry: node server/index.mjs starts the one-process LAN server.
// Env: SOLACE_PORT (default 3000), SOLACE_DB (default server/data/solace.db,
// CWD-relative when CWD is the repo root). Never wipes or seeds menu data;
// schema.sql is applied with IF NOT EXISTS on every boot.
// Optional PIN lock (Task 15): SOLACE_PIN=4-8 digits gates mutating /api
// endpoints (see app.mjs). Boot backup (Task 15): SOLACE_BACKUP_DIR (default
// server/backups/), SOLACE_BACKUP_KEEP (default 14).
import { createApp } from "./app.mjs";
import {
  backupDirFromEnv,
  backupKeepFromEnv,
  ensureTodayBackup,
} from "./boot-backup.mjs";

const port = Number(process.env.SOLACE_PORT) || 3000;
const dbPath = process.env.SOLACE_DB || "server/data/solace.db";
const backupDir = backupDirFromEnv();
const backupKeep = backupKeepFromEnv();

const app = createApp(dbPath);
app.listen(port, "0.0.0.0", () => {
  console.log(`solace listening on 0.0.0.0:${port} (db: ${dbPath})`);
  // Background boot backup: never blocks listen. Plus a 24 h re-check while
  // running (shop hours are shorter; interval is unref'd so it never holds
  // the process open on its own).
  const check = () => {
    ensureTodayBackup({ dbPath, backupDir, keep: backupKeep }).then(
      (result) => {
        if (!result.skipped) console.log(`backup ok ${result.path}`);
      },
      (err) => {
        console.log(`backup failed ${err?.message ?? err}`);
      },
    );
  };
  check();
  const timer = setInterval(check, 24 * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
});
