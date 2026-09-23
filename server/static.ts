import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  const base = await realpath(root);
  let raw: string;
  try { raw = decodeURIComponent((req.url ?? "/").split("?")[0]); }
  catch { res.writeHead(400); res.end(); return; }
  if (raw.split(/[\\/]/).some(part => part.startsWith(".")) || raw.includes("\0")) { res.writeHead(404); res.end(); return; }
  let file = resolve(base, `.${raw === "/" ? "/index.html" : raw}`);
  if (!file.startsWith(base + sep)) { res.writeHead(404); res.end(); return; }
  try { if (!(await stat(file)).isFile()) throw Error(); }
  catch { if (extname(raw)) { res.writeHead(404); res.end(); return; } file = resolve(base, "index.html"); }
  const actual = await realpath(file);
  if (!actual.startsWith(base + sep)) { res.writeHead(404); res.end(); return; }
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
  if (!types[extname(actual)]) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const content = req.method === "HEAD" ? undefined : await readFile(actual);
  res.writeHead(200, { "Content-Type": types[extname(actual)], "Cache-Control": extname(actual) === ".html" ? "no-store" : "public, max-age=3600" });
  res.end(content);
}
