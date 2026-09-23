import { z } from "zod";
import { draftSchema } from "../src/types";
import { proposalInputSchema, storeSchema } from "./domain";

const id = z.string().min(1).max(100);
export const actorSchema = z.object({ kind: z.enum(["business", "team"]), id }).strict();
export const accountSchema = z.object({ id, email: z.string().email(), name: z.string(), actor: actorSchema }).strict();
export type Account = z.infer<typeof accountSchema>;
export const sessionSchema = z.object({ account: accountSchema, csrfToken: z.string().min(32) }).strict();
export type Session = z.infer<typeof sessionSchema>;
export const snapshotSchema = z.object({ revision: z.number().int().nonnegative(), state: storeSchema, teamPoints: z.record(z.number().int().nonnegative()) }).strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const credentialsSchema = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(12).max(128) }).strict();
export const registrationSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(120), role: z.enum(["business", "team"]),
  interests: z.string().trim().max(1000).default(""),
  skills: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  technologies: z.array(z.string().trim().min(1).max(80)).max(30).default([])
}).strict();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create") }).strict(),
  z.object({ type: z.literal("edit"), taskId: id, draft: draftSchema }).strict(),
  z.object({ type: z.literal("confirm"), taskId: id, confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal("publish"), taskId: id }).strict(),
  z.object({ type: z.literal("submitProposal"), taskId: id, proposal: proposalInputSchema }).strict(),
  z.object({ type: z.literal("finalizeDecision"), taskId: id, selectedProposalIds: z.array(id).max(1000), confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal("submitResult"), taskId: id, proposalId: id, text: z.string().trim().min(1).max(20000) }).strict(),
  z.object({ type: z.literal("confirmResult"), taskId: id, proposalId: id }).strict()
]);
export type Command = z.infer<typeof commandSchema>;
export const changeSchema = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), command: commandSchema }).strict();
export type Change = z.infer<typeof changeSchema>;
export const changeResultSchema = snapshotSchema.extend({ createdId: id.optional() });
