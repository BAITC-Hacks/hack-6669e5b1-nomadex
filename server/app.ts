import { createServer, type ServerResponse } from "node:http";
import OpenAI from "openai";
import { requestSchema, fieldKeys, parseAnalysis, type AnalysisInput } from "../shared/contract";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "../shared/prompt";

export const outputJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "missingFields", "questions"],
  properties: {
    schemaVersion: { type: "integer", enum: [1] }, missingFields: { type: "array", items: { type: "string", enum: fieldKeys } },
    questions: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["id", "field", "kind", "question", "reason"], properties: {
        id: { type: "string" }, field: { type: "string", enum: fieldKeys }, kind: { type: "string", enum: ["missing", "verification"] },
        question: { type: "string" }, reason: { type: "string" }
      }
    } }
  }
};
export class AnalysisFailure extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export type Analyzer = (input: AnalysisInput) => Promise<string>;
export function createOpenAIAnalyzer(env: NodeJS.ProcessEnv = process.env, transport?: typeof fetch): Analyzer {
  return async input => {
    if (!env.OPENAI_API_KEY?.trim() || !env.OPENAI_MODEL?.trim()) throw new AnalysisFailure("NOT_CONFIGURED", 503);
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY.trim(), timeout: 15000, maxRetries: 0, fetch: transport });
    try {
      const response = await client.responses.create({
        model: env.OPENAI_MODEL.trim(), instructions: SYSTEM_PROMPT,
        input: JSON.stringify(input), store: false, max_output_tokens: 3000,
        text: { format: { type: "json_schema", name: "task_analysis", strict: true, schema: outputJsonSchema } }
      });
      if (response.status !== "completed" || !response.output_text || response.output.some(item => item.type === "message" && item.content.some(content => content.type === "refusal"))) {
        throw new AnalysisFailure("INVALID_OUTPUT", 502);
      }
      return response.output_text;
    } catch (error) {
      if (error instanceof AnalysisFailure) throw error;
      if (error instanceof OpenAI.APIConnectionTimeoutError) throw new AnalysisFailure("TIMEOUT", 504);
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401 || error.status === 403) throw new AnalysisFailure("AUTH_FAILED", 502);
        if (error.status === 429) throw new AnalysisFailure("RATE_LIMIT", 503);
      }
      throw new AnalysisFailure("AI_UNAVAILABLE", 502);
    }
  };
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
export function createApp(analyze: Analyzer = createOpenAIAnalyzer()) {
  return createServer(async (req, res) => {
    if (req.url !== "/api/analyze-task") { send(res, 404, { code: "NOT_FOUND" }); return; }
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); send(res, 405, { code: "METHOD_NOT_ALLOWED" }); return; }
    if (!req.headers["content-type"]?.startsWith("application/json")) { send(res, 415, { code: "INVALID_REQUEST" }); return; }
    let raw = "";
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 262144) { send(res, 413, { code: "INVALID_REQUEST" }); return; }
        chunks.push(Buffer.from(chunk));
      }
      raw = Buffer.concat(chunks).toString("utf8");
    } catch { send(res, 400, { code: "INVALID_REQUEST" }); return; }
    let input: AnalysisInput;
    try { input = requestSchema.parse(JSON.parse(raw)); }
    catch { send(res, 400, { code: "INVALID_REQUEST" }); return; }
    try {
      const result = await analyze(input);
      try { send(res, 200, { ...parseAnalysis(result), mode: "openai", promptVersion: PROMPT_VERSION }); }
      catch { send(res, 502, { code: "INVALID_OUTPUT" }); }
    } catch (error) {
      send(res, error instanceof AnalysisFailure ? error.status : 502, { code: error instanceof AnalysisFailure ? error.code : "AI_UNAVAILABLE" });
    }
  });
}
