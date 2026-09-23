import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { credentialsSchema, registrationSchema } from "../shared/api";
import { Auth } from "./auth";
import { Database, HttpError } from "./database";
import { createApp, type Analyzer } from "./app";
import { serveStatic } from "./static";

type Options = { origins: string[]; secureCookies?: boolean; analyze?: Analyzer; staticRoot?: string };
export function createPlatform(db: Database, options: Options) {
  const auth = new Auth(db, options.secureCookies ?? false);
  const ai = createApp(options.analyze);
  const origins = new Set(options.origins);
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const path = req.url?.split("?")[0];
      if (req.method === "GET" && path === "/api/health") { send(res, 200, { ok: true }); return; }
      if (!path?.startsWith("/api/")) {
        if (options.staticRoot) { await serveStatic(req, res, options.staticRoot); return; }
        throw new HttpError(404, "NOT_FOUND", "Адрес не найден.");
      }
      if (!["GET", "POST"].includes(req.method ?? "")) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Метод не поддерживается.");
      if (req.method === "POST") {
        // Configured public origins, not client-controlled Host or forwarded headers.
        if (!origins.has(String(req.headers.origin))) throw new HttpError(403, "ORIGIN_REJECTED", "Источник запроса не разрешён.");
        if (req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "JSON_REQUIRED", "Ожидается JSON.");
      }
      const ip = req.socket.remoteAddress ?? "unknown";
      if (req.method === "POST" && (path === "/api/auth/register" || path === "/api/auth/login")) {
        db.rateLimit(`auth-ip:${ip}`, 30, 15 * 60 * 1000);
        const raw = await readJson(req);
        const input = path.endsWith("register") ? registrationSchema.parse(raw) : credentialsSchema.parse(raw);
        db.rateLimit(`auth-email:${input.email}`, 10, 15 * 60 * 1000);
        const result = path.endsWith("register") ? await auth.register(input) : await auth.login(input.email, input.password);
        res.setHeader("Set-Cookie", result.cookie); send(res, path.endsWith("register") ? 201 : 200, result.session); return;
      }
      const session = auth.session(req);
      if (req.method === "POST") {
        if (req.headers["x-csrf-token"] !== session.csrfToken) throw new HttpError(403, "CSRF_REJECTED", "Обновите сессию и повторите действие.");
        db.rateLimit(`write:${session.account.id}`, 120, 60000);
      }
      if (req.method === "GET" && path === "/api/auth/session") { send(res, 200, session); return; }
      if (req.method === "POST" && path === "/api/auth/logout") { res.setHeader("Set-Cookie", auth.logout(req)); send(res, 200, { ok: true }); return; }
      if (req.method === "GET" && path === "/api/state") { send(res, 200, db.snapshot(session.account.actor)); return; }
      if (req.method === "POST" && path === "/api/commands") { send(res, 200, db.change(session.account, await readJson(req) as never)); return; }
      if (req.method === "GET" && path === "/api/audit") {
        // Journal payloads may contain other users' data; expose only own action metadata.
        const events = db.sql.prepare("SELECT id,action,entity_id AS entityId,at FROM audit WHERE account_id=? ORDER BY id DESC LIMIT 100").all(session.account.id);
        send(res, 200, { events }); return;
      }
      if (req.method === "POST" && path === "/api/analyze-task") {
        if (session.account.actor.kind !== "business") throw new HttpError(403, "FORBIDDEN", "Анализ задачи доступен бизнесу.");
        db.rateLimit(`ai:${session.account.id}`, 10, 60000);
        ai.emit("request", req, res); return;
      }
      throw new HttpError(404, "NOT_FOUND", "Адрес не найден.");
    } catch (error) {
      if (error instanceof HttpError) { send(res, error.status, { code: error.code, message: error.message }); return; }
      if (error instanceof ZodError || error instanceof SyntaxError) { send(res, 400, { code: "INVALID_REQUEST", message: "Проверьте поля запроса." }); return; }
      // Never return SQL, credentials, stack traces or submitted bodies.
      send(res, 500, { code: "SERVER_ERROR", message: "Не удалось выполнить действие. Повторите позже." });
    }
  });
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 262144) throw new HttpError(413, "TOO_LARGE", "Запрос слишком большой.");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
