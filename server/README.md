# Solace server

One-process LAN server: Node + Express + better-sqlite3, serving `GET /api/*`
and static `client/dist`. Entry: `node server/index.mjs`
(env `SOLACE_PORT` default 3000, `SOLACE_DB` default `server/data/solace.db`).
REST: JSON everywhere, `/api` plural nouns, POST 201 / PATCH 200 / DELETE 204,
errors `{error}` (400/404/500), money `*_cents`, timestamps `YYYY-MM-DD HH:MM:SS`.
Tests: `server/api.test.mjs` spins `createApp(tempDb)` (see `server/app.mjs`).
