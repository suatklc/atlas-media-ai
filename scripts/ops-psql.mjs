// Runs psql as the read-only atlas_ops_reader role using the existing
// pgpass entry (created by scripts/ops-reader-password.mjs).
// - Reads ONLY host/port/database/user of the atlas_ops_reader line; the
//   password field is never read into a variable, logged or passed on —
//   psql looks it up in pgpass itself (-w: never prompt).
// - Prints nothing but psql's own output.
//
// Usage:
//   node scripts/ops-psql.mjs -c "select count(*) from ops.telegram_job_status;"
//   node scripts/ops-psql.mjs -f supabase/ops/0006_verify_reader.sql
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PSQL = process.platform === "win32" ? "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe" : "psql";
const pgpass = process.platform === "win32"
  ? path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "postgresql", "pgpass.conf")
  : path.join(homedir(), ".pgpass");

if (!existsSync(pgpass)) {
  console.error("pgpass file not found; run scripts/ops-reader-password.mjs first.");
  process.exit(1);
}
const entries = readFileSync(pgpass, "utf8")
  .split(/\r?\n/)
  .map((line) => line.split(":"))
  .filter((fields) => fields.length >= 5 && fields[3].startsWith("atlas_ops_reader."))
  .map(([host, port, database, user]) => ({ host, port, database, user }));
if (entries.length !== 1) {
  console.error(`Expected exactly one atlas_ops_reader entry in pgpass, found ${entries.length}.`);
  process.exit(1);
}
const { host, port, database, user } = entries[0];
const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/ops-psql.mjs -c "<sql>" | -f <file.sql>');
  process.exit(1);
}

// The password always comes from pgpass, never from the environment.
const env = { ...process.env, PGHOST: host, PGPORT: port, PGDATABASE: database, PGUSER: user, PGSSLMODE: "require" };
delete env.PGPASSWORD;
const result = spawnSync(PSQL, ["-X", "-w", "-v", "ON_ERROR_STOP=1", ...args], { stdio: "inherit", env });
process.exit(result.status ?? 1);
