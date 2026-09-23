import "dotenv/config";
import { resolve } from "node:path";
import { Database } from "../server/database";
import { copyDatabase, recoverEvent, seedDatabase } from "../server/maintenance";

const [operation, first, second, third] = process.argv.slice(2);
const source = resolve(process.env.DATABASE_PATH ?? `data/${process.env.NODE_ENV ?? "development"}.sqlite`);
if (operation === "migrate" || operation === "seed") {
  const db = new Database(source);
  try {
    if (operation === "seed") {
      if (process.env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production");
      const emails = await seedDatabase(db, process.env.SEED_PASSWORD ?? "");
      console.log("Demo accounts:", emails.join(", "));
    } else console.log("Database migrations applied");
  } finally { db.close(); }
} else if (operation === "backup") {
  if (!first) throw new Error("Usage: npm run db:backup -- <new-backup.sqlite>");
  await copyDatabase(source, resolve(first)); console.log("Backup created");
} else if (operation === "restore") {
  if (!first || !second) throw new Error("Usage: npm run db:restore -- <backup.sqlite> <new-database.sqlite>");
  await copyDatabase(resolve(first), resolve(second)); console.log("Restored to a new database. Set DATABASE_PATH and restart the server.");
} else if (operation === "recover") {
  if (!first || !second || !third || !/^\d+$/.test(second)) throw new Error("Usage: npm run db:recover -- <backup.sqlite> <event-id> <new-database.sqlite>");
  await copyDatabase(resolve(first), resolve(third));
  const db = new Database(resolve(third));
  try { recoverEvent(db, Number(second)); } finally { db.close(); }
  console.log("Recovered workflow state into a new database. Sessions invalidated; inspect before switching DATABASE_PATH.");
} else throw new Error("Unknown database operation");
