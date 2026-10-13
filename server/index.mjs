// Entry: node server/index.mjs starts the one-process LAN server.
// Env: SOLACE_PORT (default 3000), SOLACE_DB (default server/data/solace.db,
// CWD-relative when CWD is the repo root). Never wipes or seeds menu data;
// schema.sql is applied with IF NOT EXISTS on every boot.
import { createApp } from "./app.mjs";

const port = Number(process.env.SOLACE_PORT) || 3000;
const dbPath = process.env.SOLACE_DB || "server/data/solace.db";

const app = createApp(dbPath);
app.listen(port, "0.0.0.0", () => {
  console.log(`solace listening on 0.0.0.0:${port} (db: ${dbPath})`);
});
