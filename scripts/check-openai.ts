import "dotenv/config";
import { once } from "node:events";
import { createApp } from "../server/app";
import { emptyFields, errorMessages, parseAnalysis } from "../shared/contract";

// An explicit, real check: never use a local fallback or log credentials/provider errors.
async function main() {
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) {
    console.error("NOT_CONFIGURED: задайте OPENAI_API_KEY и OPENAI_MODEL в .env или окружении. Реальный запрос не выполнен.");
    process.exitCode = 2;
    return;
  }
  const server = createApp();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/analyze-task`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ schemaVersion: 1, description: "Синтетический пример: заявки теряются между таблицами. Нужен единый список заявок для менеджеров.", fields: emptyFields(), previousAnswers: [] })
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" && Object.hasOwn(errorMessages, body.code) ? body.code : "AI_UNAVAILABLE";
      console.error(`${code}: ${errorMessages[code]} Реальная проверка не пройдена.`);
      process.exitCode = 1;
      return;
    }
    if (!body || typeof body !== "object" || !("mode" in body) || body.mode !== "openai" || !("promptVersion" in body) || body.promptVersion !== 1) throw new Error();
    const { mode, promptVersion, ...payload } = body;
    const analysis = parseAnalysis(JSON.stringify(payload));
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode, promptVersion, questions: analysis.questions, missingFields: analysis.missingFields }, null, 2));
    console.log("Реальный запрос OpenAI и контракт пройдены. Проверьте смысл вопросов; затем повторите анализ в браузере.");
  } catch {
    console.error("CHECK_FAILED: не удалось завершить проверку endpoint. Проверьте сеть и настройки; секреты и внутренние ошибки не выводятся.");
    process.exitCode = 1;
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
await main();
