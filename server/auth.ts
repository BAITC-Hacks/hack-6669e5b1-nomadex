import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { registrationSchema, type Account } from "../shared/api";
import { Database, hash, HttpError } from "./database";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
function publicAccount(row: Record<string, unknown>): Account {
  return { id: String(row.id), email: String(row.email), name: String(row.name), actor: row.business_id ? { kind: "business", id: String(row.business_id) } : { kind: "team", id: String(row.team_id) } };
}
export class Auth {
  constructor(private db: Database, private secureCookies: boolean) {}
  async register(raw: unknown) {
    const input = registrationSchema.parse(raw);
    const encoded = await passwordHash(input.password);
    return this.db.transaction(() => {
      if (this.db.sql.prepare("SELECT id FROM accounts WHERE email=?").get(input.email)) throw new HttpError(409, "ACCOUNT_EXISTS", "Учётная запись с таким адресом уже существует.");
      const before = this.db.readState();
      const id = randomUUID(); const actorId = `${input.role}-${randomUUID()}`;
      const state = input.role === "business" ? { ...before, businesses: [...before.businesses, { id: actorId, name: input.name, description: "" }] } : { ...before, teams: [...before.teams, { id: actorId, name: input.name, interests: input.interests || "Пока не указаны", skills: input.skills, technologies: input.technologies }] };
      this.db.writeState(state);
      this.db.sql.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?)").run(id, input.email, input.name, encoded, input.role === "business" ? actorId : null, input.role === "team" ? actorId : null);
      this.db.advance(); this.db.audit(id, "register", actorId, before, state);
      return this.issue({ id, email: input.email, name: input.name, actor: { kind: input.role, id: actorId } });
    });
  }
  async login(email: string, password: string) {
    const row = this.db.sql.prepare("SELECT * FROM accounts WHERE email=?").get(email);
    // Perform the same expensive work for an unknown email.
    const [, salt, expected] = row ? String(row.password_hash).split("$") : ["scrypt", "00000000000000000000000000000000", "0".repeat(128)];
    const key = await derive(password, salt);
    if (!row || !timingSafeEqual(key, Buffer.from(expected, "hex"))) throw new HttpError(401, "INVALID_CREDENTIALS", "Неверный адрес или пароль.");
    return this.issue(publicAccount(row));
  }
  private issue(account: Account) {
    const token = randomBytes(32).toString("hex"); const csrfToken = randomBytes(32).toString("hex");
    this.db.sql.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    this.db.sql.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(hash(token), account.id, csrfToken, Date.now() + SESSION_MS);
    return { session: { account, csrfToken }, cookie: this.cookie(token, SESSION_MS / 1000) };
  }
  private cookie(token: string, seconds: number) { return `nomadex_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${this.secureCookies ? "; Secure" : ""}`; }
  private token(req: IncomingMessage) {
    const token = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("nomadex_session="))?.slice("nomadex_session=".length);
    return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
  }
  session(req: IncomingMessage) {
    const token = this.token(req);
    const row = token ? this.db.sql.prepare("SELECT a.*,s.csrf_token FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?").get(hash(token), Date.now()) : undefined;
    if (!row) throw new HttpError(401, "UNAUTHENTICATED", "Войдите в свой аккаунт.");
    return { account: publicAccount(row), csrfToken: String(row.csrf_token) };
  }
  logout(req: IncomingMessage) {
    const token = this.token(req);
    if (token) this.db.sql.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
    return this.cookie("", 0);
  }
}
