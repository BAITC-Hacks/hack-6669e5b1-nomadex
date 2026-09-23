import { z } from "zod";
import { answerSchema, emptyFields, fieldsSchema } from "../shared/contract";
export type { Analysis } from "../shared/contract";
export const draftSchema = fieldsSchema.extend({
  title: z.string().max(200), description: z.string().max(8000), industry: z.string().max(200),
  answers: z.array(answerSchema).max(20)
}).strict();
export type Draft = z.infer<typeof draftSchema>;
export const createEmptyDraft = (): Draft => ({ title: "", description: "", industry: "", ...emptyFields(), answers: [] });
export type Profile = "business" | `team-${string}`;
