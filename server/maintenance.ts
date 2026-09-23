import { DatabaseSync, backup } from "node:sqlite";
import { closeSync, existsSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createSeedState, storeSchema } from "../shared/domain";
import { Database } from "./database";
import { passwordHash } from "./auth";

export async function seedDatabase(db: Database, password: string) {
  if (password.length < 12 || password.length > 128) throw new Error("SEED_PASSWORD must contain 12–128 characters");
  const state = createSeedState();
  const profiles = [...state.businesses.map(p => ({ ...p, kind: "business" })), ...state.teams.map(p => ({ ...p, kind: "team" }))];
  const hashes = await Promise.all(profiles.map(() => passwordHash(password)));
  db.transaction(() => {
    const before = db.readState();
    if (before.businesses.length || before.teams.length || before.tasks.length || db.sql.prepare("SELECT id FROM accounts LIMIT 1").get()) throw new Error("Seed requires an empty database");
    db.writeState(state);
    profiles.forEach((p, i) => db.sql.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?)").run(randomUUID(), `${p.id}@demo.invalid`, p.name, hashes[i], p.kind === "business" ? p.id : null, p.kind === "team" ? p.id : null));
    db.advance(); db.audit(null, "seed", null, before, state);
  });
  return profiles.map(p => `${p.id}@demo.invalid`);
}

export async function copyDatabase(source: string, destination: string) {
  if (!existsSync(source) || resolve(source) === resolve(destination)) throw new Error("Use an existing source and a new destination");
  const src = new DatabaseSync(source, { readOnly: true });
  try {
    if (src.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" || src.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Source database failed integrity validation");
    // Refuse to overwrite an existing file. Backup itself handles the source WAL.
    closeSync(openSync(destination, "wx", 0o600));
    await backup(src, destination);
  } finally { src.close(); }
}

export function recoverEvent(db: Database, eventId: number) {
  db.transaction(() => {
    const event = db.sql.prepare("SELECT after_json FROM audit WHERE id=?").get(eventId);
    if (!event) throw new Error("Audit event not found");
    const before = db.readState(); const restored = storeSchema.parse(JSON.parse(String(event.after_json)));
    // Preserve account/profile identity, but restore workflow data to the event.
    const after = { ...restored, businesses: before.businesses, teams: before.teams };
    db.sql.exec("DELETE FROM results; DELETE FROM decisions; DELETE FROM proposals; DELETE FROM tasks; DELETE FROM receipts; DELETE FROM sessions;");
    db.writeState(after); db.advance(); db.audit(null, "recover", String(eventId), before, after);
  });
}
