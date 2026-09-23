import { changeResultSchema, sessionSchema, snapshotSchema, type Change, type Command } from "../shared/api";
import type { StoreAction } from "./store";
let csrfToken = "";
export function setCsrfToken(token: string) { csrfToken = token; }
export function mutationHeaders() { return { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }; }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export async function request(path: string, body?: unknown) {
  let response: Response;
  try { response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: body === undefined ? undefined : mutationHeaders(), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
  catch { throw new ApiError(0, "NETWORK_ERROR", "Сервер недоступен. Изменения не подтверждены; текст остаётся в форме."); }
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.code ?? "SERVER_ERROR", data.message ?? "Не удалось выполнить запрос.");
  return data;
}
export async function getSession() { const session = sessionSchema.parse(await request("/api/auth/session")); setCsrfToken(session.csrfToken); return session; }
export async function getSnapshot() { return snapshotSchema.parse(await request("/api/state")); }
export async function change(envelope: Change) {
  // Retrying an ambiguous network response uses the same persisted receipt ID.
  try { return changeResultSchema.parse(await request("/api/commands", envelope)); }
  catch (error) { if (!(error instanceof ApiError) || error.status !== 0) throw error; return changeResultSchema.parse(await request("/api/commands", envelope)); }
}
export function commandFromAction(action: StoreAction): Command {
  switch (action.type) {
    case "create": return { type: "create" };
    case "edit": return { type: "edit", taskId: action.taskId, draft: action.draft };
    case "confirm": return { type: "confirm", taskId: action.taskId, confirmed: action.confirmed };
    case "publish": return { type: "publish", taskId: action.taskId };
    case "submitProposal": return { type: "submitProposal", taskId: action.taskId, proposal: action.proposal };
    case "finalizeDecision": return { type: "finalizeDecision", taskId: action.taskId, selectedProposalIds: action.selectedProposalIds, confirmed: action.confirmed };
    case "submitResult": return { type: "submitResult", taskId: action.taskId, proposalId: action.proposalId, text: action.text };
    case "confirmResult": return { type: "confirmResult", taskId: action.taskId, proposalId: action.proposalId };
  }
}
