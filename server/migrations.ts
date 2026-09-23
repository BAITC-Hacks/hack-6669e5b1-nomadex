import type { DatabaseSync } from "node:sqlite";

// Append migrations; never edit a migration once it has shipped.
const migrations = [
  `CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
   INSERT INTO meta(id) VALUES(1);
   CREATE TABLE businesses (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE teams (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE accounts (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
     password_hash TEXT NOT NULL, business_id TEXT REFERENCES businesses(id), team_id TEXT REFERENCES teams(id),
     CHECK ((business_id IS NOT NULL AND team_id IS NULL) OR (business_id IS NULL AND team_id IS NOT NULL))
   );
   CREATE TABLE tasks (id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE proposals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), team_id TEXT NOT NULL REFERENCES teams(id), data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(task_id,team_id));
   CREATE TABLE decisions (task_id TEXT PRIMARY KEY REFERENCES tasks(id), finalized_at TEXT NOT NULL, selected_ids TEXT NOT NULL CHECK(json_valid(selected_ids)));
   CREATE TABLE results (proposal_id TEXT PRIMARY KEY REFERENCES proposals(id), data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
   CREATE INDEX sessions_expiry ON sessions(expires_at);
   CREATE TABLE receipts (account_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL, command_hash TEXT NOT NULL, created_id TEXT, PRIMARY KEY(account_id,request_id));
   CREATE TABLE audit (id INTEGER PRIMARY KEY, account_id TEXT REFERENCES accounts(id), action TEXT NOT NULL, entity_id TEXT, at TEXT NOT NULL, before_json TEXT NOT NULL CHECK(json_valid(before_json)), after_json TEXT NOT NULL CHECK(json_valid(after_json)));
   CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
   CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);`
];

export function migrate(db: DatabaseSync) {
  // Read the version after acquiring the lock: concurrent startup cannot apply it twice.
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
    if (version > migrations.length) throw new Error("Database schema is newer than this server");
    for (let i = version; i < migrations.length; i++) {
      db.exec(migrations[i]); db.exec(`PRAGMA user_version = ${i + 1}`);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
