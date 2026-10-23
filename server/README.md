# Solace server

One-process LAN server: Node + Express + better-sqlite3, serving `GET /api/*`
and static `client/dist`. Entry: `node server/index.mjs`
(env `SOLACE_PORT` default 3000, `SOLACE_DB` default `server/data/solace.db`).
REST: JSON everywhere, `/api` plural nouns, POST 201 / PATCH 200 / DELETE 204,
errors `{error}` (400/404/500), money `*_cents`, timestamps `YYYY-MM-DD HH:MM:SS`.
Tests: `server/api.test.mjs` spins `createApp(tempDb)` (see `server/app.mjs`).

## Windows LAN auto-start

The tablet connects to `http://<laptop-LAN-IP>:3000` (currently
`http://192.168.1.8:3000`). Open `http://localhost:3000/tablet` on the laptop
for the connection page and QR code; the `Solace tablet link` desktop shortcut
opens the same page.

The `Solace URL` desktop shortcut is the no-QR way to reach the app. It opens a
terminal, prints the current LAN URL and whether it changed since the last
server start, copies the URL to the clipboard, and opens the app. The `/tablet`
page remains the authoritative source for the address.

The `Solace LAN` inbound firewall rule allows TCP local port 3000 from the
local subnet (remote address `LocalSubnet`, all profiles, enabled). The
installer ensures the rule on every run, recreating it so its settings always
match. Without it the tablet cannot reach the laptop.

The `Solace Server` scheduled task starts the server at Mathew's logon. It runs
hidden as a single instance through `wscript.exe`, and restarts the server on
failure. Install or update it from an elevated PowerShell:

```powershell
Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\CODE\Solace\scripts\install-lan.ps1' -Wait
```

Logs: `%LOCALAPPDATA%\Solace\logs`.

From the repo root, stop and start the server:

```powershell
# Elevated stop of the task and its wscript/powershell/node tree
powershell -ExecutionPolicy Bypass -File C:\CODE\Solace\scripts\stop-lan.ps1

Start-ScheduledTask -TaskName "Solace Server"
```

To remove the auto-start, run the stop helper elevated, then in an elevated
PowerShell:

```powershell
Unregister-ScheduledTask -TaskName "Solace Server" -Confirm:$false
Remove-Item "$env:USERPROFILE\Desktop\Solace tablet link.url"
Remove-Item "$env:USERPROFILE\Desktop\Solace URL.lnk"
```

Then run `npm start` from the repo root for a manual server.

After UI changes, run `npm run build` when the tablet is idle; the running
server serves the new files.

This LAN setup replaces the Cloudflare quick tunnel. Cloudflare and its service
and scheduled task were removed, so LAN is the only access path and the old
public URL no longer works.

The laptop must be signed in, awake, and on the same Wi-Fi as the tablet.

## Backups (daily, manual, OS-scheduled, or server boot check)

Backup: `node server/db/backup.mjs [db-path] [backup-dir] [--keep N]`
(defaults: `SOLACE_DB` env or `server/data/solace.db`; `server/backups/`,
`--keep 14`). Uses the SQLite online-backup API, writes
`solace-YYYYMMDD-HHMMSS.db`, prints the created path, prunes older
`solace-*.db` files beyond N newest. Restore check:
`node server/db/backup.mjs --verify <backup-path>` (integrity_check `ok` +
all 14 tables + counts; exit 0 clean, non-zero `{error}` otherwise).

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
