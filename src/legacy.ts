import { z } from "zod";
import { normalizeField } from "../shared/contract";
// Frozen v2 contract: validate old data before adding unknown fields or recalculating.
export const legacyKeys = ["problemContext", "expectedResult", "acceptanceCriteria", "scope", "resources", "timingConstraints"] as const;
const field = z.enum(legacyKeys);
const legacyFields = z.object(Object.fromEntries(legacyKeys.map(k => [k, z.string().max(2000).nullable()])) as Record<typeof legacyKeys[number], z.ZodNullable<z.ZodString>>).strict();
export const legacyDraftSchema = legacyFields.extend({ title: z.string().max(200), description: z.string().max(8000), industry: z.string().max(200),
  answers: z.array(z.object({ questionId: z.string().min(1).max(100), field, answer: z.string().max(2000) }).strict()).max(20) }).strict();
export const legacyQuestions = z.array(z.object({ id: z.string().trim().min(1).max(100), field, kind: z.enum(["missing", "verification"]), question: z.string().trim().min(1).max(500), reason: z.string().trim().min(1).max(300) }).strict()).max(6);
export function legacyScore(fields: z.infer<typeof legacyFields>) {
  return legacyKeys.reduce((sum, key, index) => sum + (normalizeField(fields[key]) ? [20,20,20,15,15,10][index] : 0), 0);
}
