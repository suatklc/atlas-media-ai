// Creates the atlas_ops_reader password LOCALLY (Node built-ins only).
// - The plaintext password is written ONLY to the local pgpass file
//   (%APPDATA%\postgresql\pgpass.conf on Windows, ~/.pgpass elsewhere) and
//   is never printed.
// - Prints only an ALTER ROLE statement carrying the SCRAM-SHA-256
//   verifier (a salted hash, not the password) to paste once into the
//   Supabase SQL Editor (then delete that snippet).
//
// Usage: node scripts/ops-reader-password.mjs <pooler-host> <project-ref>
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const [host, projectRef] = process.argv.slice(2);
if (!host || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host) || !projectRef || !/^[a-z0-9]{10,40}$/.test(projectRef)) {
  console.error("Usage: node scripts/ops-reader-password.mjs <xxx.pooler.supabase.com> <project-ref>");
  process.exit(1);
}

const ROLE = "atlas_ops_reader";
const user = `${ROLE}.${projectRef}`;
const port = "5432";
const pgpass = process.platform === "win32"
  ? path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "postgresql", "pgpass.conf")
  : path.join(homedir(), ".pgpass");

const prefix = `${host}:${port}:postgres:${user}:`;
if (existsSync(pgpass) && readFileSync(pgpass, "utf8").split(/\r?\n/).some((line) => line.startsWith(prefix))) {
  console.error(`An entry for ${user} already exists in ${pgpass}. Remove it first to rotate the password.`);
  process.exit(1);
}

// 32 random bytes, base64url: ASCII only (SASLprep is the identity), no ':' or '\'.
const password = randomBytes(32).toString("base64url");

// RFC 5802 / RFC 7677 SCRAM-SHA-256 verifier, PostgreSQL format.
const salt = randomBytes(16);
const iterations = 4096;
const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const clientKey = createHmac("sha256", salted).update("Client Key").digest();
const storedKey = createHash("sha256").update(clientKey).digest();
const serverKey = createHmac("sha256", salted).update("Server Key").digest();
const verifier = `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;

mkdirSync(path.dirname(pgpass), { recursive: true });
appendFileSync(pgpass, `${prefix}${password}\n`, { encoding: "utf8" });
if (process.platform !== "win32") chmodSync(pgpass, 0o600);

console.log(`Password stored in ${pgpass} (not shown).`);
console.log("Paste ONCE into the Supabase SQL Editor, run, then delete the snippet:\n");
console.log(`alter role ${ROLE} password '${verifier}';`);
