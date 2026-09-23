import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { migrate } from "./migrations";
import { reduceStore, selectTeamPoints, storeSchema, type Actor, type AppState, type StoreAction } from "../shared/domain";
import { changeSchema, type Account, type Change, type Snapshot } from "../shared/api";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class Database {
  readonly sql: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    try {
      this.sql.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
      migrate(this.sql);
    } catch (error) { this.sql.close(); throw error; }
  }
  close() { this.sql.close(); }
  transaction<T>(work: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.sql.exec("COMMIT"); return result; }
    catch (error) { this.sql.exec("ROLLBACK"); throw error; }
  }
  readState(): AppState {
    const read = (table: string) => this.sql.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(String(row.data)));
    return storeSchema.parse({ schemaVersion: 3, businesses: read("businesses"), teams: read("teams"), tasks: read("tasks"), proposals: read("proposals"), results: read("results") });
  }
  writeState(raw: AppState) {
    const state = storeSchema.parse(raw);
    for (const p of state.businesses) this.sql.prepare("INSERT INTO businesses VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(p.id, JSON.stringify(p));
    for (const p of state.teams) this.sql.prepare("INSERT INTO teams VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(p.id, JSON.stringify(p));
    for (const t of state.tasks) this.sql.prepare("INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(t.id, t.businessId, JSON.stringify(t));
    for (const p of state.proposals) this.sql.prepare("INSERT INTO proposals VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(p.id, p.taskId, p.teamId, JSON.stringify(p));
    for (const r of state.results) this.sql.prepare("INSERT INTO results VALUES (?,?) ON CONFLICT(proposal_id) DO UPDATE SET data=excluded.data").run(r.proposalId, JSON.stringify(r));
    for (const t of state.tasks.filter(t => t.decisionFinalizedAt)) this.sql.prepare("INSERT INTO decisions VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET finalized_at=excluded.finalized_at,selected_ids=excluded.selected_ids").run(t.id, t.decisionFinalizedAt!, JSON.stringify(state.proposals.filter(p => p.taskId === t.id && p.status === "selected").map(p => p.id)));
  }
  revision() { return Number(this.sql.prepare("SELECT revision FROM meta WHERE id=1").get()!.revision); }
  advance() { this.sql.exec("UPDATE meta SET revision=revision+1 WHERE id=1"); }
  audit(accountId: string | null, action: string, entity: string | null, before: AppState, after: AppState) {
    this.sql.prepare("INSERT INTO audit(account_id,action,entity_id,at,before_json,after_json) VALUES(?,?,?,?,?,?)").run(accountId, action, entity, new Date().toISOString(), JSON.stringify(before), JSON.stringify(after));
  }
  snapshot(actor: Actor): Snapshot {
    // Keep revision, visibility and data in one SQLite snapshot across server processes.
    return this.transaction(() => this.project(actor));
  }
  private project(actor: Actor): Snapshot {
    const full = this.readState();
    const tasks = full.tasks.filter(t => t.status === "published" || (actor.kind === "business" && t.businessId === actor.id));
    const owned = new Set(full.tasks.filter(t => actor.kind === "business" && t.businessId === actor.id).map(t => t.id));
    const proposals = full.proposals.filter(p => owned.has(p.taskId) || (actor.kind === "team" && p.teamId === actor.id));
    const visible = new Set(proposals.map(p => p.id));
    return { revision: this.revision(), state: { ...full, tasks, proposals, results: full.results.filter(r => visible.has(r.proposalId)) }, teamPoints: Object.fromEntries(full.teams.map(t => [t.id, selectTeamPoints(full, t.id)])) };
  }
  change(account: Account, raw: Change) {
    const change = changeSchema.parse(raw);
    return this.transaction(() => {
      const commandHash = hash(JSON.stringify(change.command));
      const receipt = this.sql.prepare("SELECT command_hash,created_id FROM receipts WHERE account_id=? AND request_id=?").get(account.id, change.requestId);
      if (receipt) {
        if (receipt.command_hash !== commandHash) throw new HttpError(409, "REQUEST_REUSED", "Номер запроса уже использован для другого действия.");
        return { ...this.project(account.actor), ...(receipt.created_id ? { createdId: String(receipt.created_id) } : {}) };
      }
      const state = this.readState();
      const c = change.command;
      if (c.type === "create") {
        if (account.actor.kind !== "business") throw new HttpError(403, "FORBIDDEN", "Создание задачи доступно бизнесу.");
      } else {
        const task = state.tasks.find(t => t.id === c.taskId);
        const isOwner = task && account.actor.kind === "business" && task.businessId === account.actor.id;
        if (!task || (task.status === "draft" && !isOwner)) throw new HttpError(404, "NOT_FOUND", "Задача не найдена.");
        const teamAction = c.type === "submitProposal" || c.type === "submitResult";
        if (teamAction ? account.actor.kind !== "team" : !isOwner) throw new HttpError(403, "FORBIDDEN", "Недостаточно прав для этого действия.");
        if (c.type === "submitResult" && !state.proposals.some(p => p.id === c.proposalId && p.taskId === c.taskId && p.teamId === account.actor.id)) throw new HttpError(403, "FORBIDDEN", "Можно отправить только свой результат.");
      }
      if (change.expectedRevision !== this.revision()) throw new HttpError(409, "CONFLICT", "Данные изменились. Обновите карточку и повторите действие.");
      const now = new Date().toISOString();
      const createdId = c.type === "create" ? `task-${randomUUID()}` : c.type === "submitProposal" ? `proposal-${randomUUID()}` : undefined;
      const action = { ...c, actor: account.actor, ...(createdId ? { id: createdId } : {}), ...(c.type === "publish" ? { publishedAt: now } : {}), ...(c.type === "finalizeDecision" ? { finalizedAt: now } : {}), ...(c.type === "confirmResult" ? { confirmedAt: now } : {}) } as StoreAction;
      let next: AppState;
      try { next = reduceStore(state, action); }
      catch (error) { throw new HttpError(422, "INVALID_TRANSITION", error instanceof Error && error.name !== "ZodError" ? error.message : "Некорректные данные действия."); }
      if (next !== state) {
        this.writeState(next); this.advance();
        this.audit(account.id, c.type, c.type === "create" ? createdId! : c.taskId, state, next);
      }
      this.sql.prepare("INSERT INTO receipts VALUES(?,?,?,?)").run(account.id, change.requestId, commandHash, createdId ?? null);
      return { ...this.project(account.actor), ...(createdId ? { createdId } : {}) };
    });
  }
  rateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
    this.transaction(() => {
      this.sql.prepare("DELETE FROM rate_limits WHERE expires_at<=?").run(now);
      this.sql.prepare("INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1").run(hash(key), now + windowMs);
    });
    const row = this.sql.prepare("SELECT hits FROM rate_limits WHERE key=?").get(hash(key));
    if (Number(row!.hits) > limit) throw new HttpError(429, "RATE_LIMIT", "Слишком много запросов. Попробуйте позже.");
  }
}
