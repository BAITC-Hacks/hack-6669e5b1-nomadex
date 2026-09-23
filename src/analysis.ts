import { fallback, parseAnalysis, requestSchema, errorMessages, type AnalysisInput, type Analysis } from "../shared/contract";
import { mutationHeaders } from "./api";
export type AnalysisResult = { analysis: Analysis; warning: string | null };
export async function analyzeTask(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisResult> {
  requestSchema.parse(input);
  let code = "NETWORK_ERROR";
  try {
    const response = await fetch("/api/analyze-task", {
      method: "POST", credentials: "same-origin", headers: mutationHeaders(), body: JSON.stringify(input),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(18000)]) : AbortSignal.timeout(18000)
    });
    if (!response.ok) {
      const data: unknown = await response.json();
      if (data && typeof data === "object" && "code" in data && typeof data.code === "string" && data.code in errorMessages) code = data.code;
      throw new Error(code);
    }
    code = "INVALID_OUTPUT";
    const data: unknown = JSON.parse(await response.text());
    if (!data || typeof data !== "object" || !("mode" in data) || data.mode !== "openai" || !("promptVersion" in data) || data.promptVersion !== 2) throw new Error(code);
    const { mode: _mode, promptVersion: _version, ...payload } = data;
    return { analysis: { ...parseAnalysis(JSON.stringify(payload)), mode: "openai", promptVersion: 2 }, warning: null };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { analysis: fallback(input), warning: errorMessages[code] + " Показаны локальные подсказки." };
  }
}
