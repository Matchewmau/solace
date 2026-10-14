# Solace server

One-process LAN server: Node + Express + better-sqlite3, serving `GET /api/*`
and static `client/dist`. Entry: `node server/index.mjs`
(env `SOLACE_PORT` default 3000, `SOLACE_DB` default `server/data/solace.db`).
REST: JSON everywhere, `/api` plural nouns, POST 201 / PATCH 200 / DELETE 204,
errors `{error}` (400/404/500), money `*_cents`, timestamps `YYYY-MM-DD HH:MM:SS`.
Tests: `server/api.test.mjs` spins `createApp(tempDb)` (see `server/app.mjs`).

## Backups (daily, manual, OS-scheduled, or server boot check)

Backup: `node server/db/backup.mjs [db-path] [backup-dir] [--keep N]`
(defaults: `SOLACE_DB` env or `server/data/solace.db`; `server/backups/`,
`--keep 14`). Uses the SQLite online-backup API, writes
`solace-YYYYMMDD-HHMMSS.db`, prints the created path, prunes older
`solace-*.db` files beyond N newest. Restore check:
`node server/db/backup.mjs --verify <backup-path>` (integrity_check `ok` +
all 13 tables + counts; exit 0 clean, non-zero `{error}` otherwise).

When the server starts, it creates one backup if no backup for the local
calendar day exists, then rechecks every 24 hours while running. Configure
the destination and retention with `SOLACE_BACKUP_DIR` and
`SOLACE_BACKUP_KEEP`. Manual and OS-scheduled backups remain available for
off-hours coverage.

Daily invocation snippets (run from the repo root):

```bat
schtasks /create /tn "SolaceBackup" /tr "cmd /c \"cd /d <repo-root> && node server\db\backup.mjs\"" /sc daily /st 23:30
```

Substitute your checkout path for `<repo-root>` (e.g. `C:\CODE\Solace`).

```cron
30 23 * * * cd /opt/solace && node server/db/backup.mjs >> /var/log/solace-backup.log 2>&1
```
