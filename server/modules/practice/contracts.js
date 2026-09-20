import { z } from "zod";
import { poolSchema, subjectSchema } from "../catalog/contracts.js";

export const practiceScopeSchema = z.object({
  subject: subjectSchema,
  pool: poolSchema
}).strict();

export const createModuleSchema = practiceScopeSchema.extend({
  mode: z.enum(["random", "realistic", "section"]).default("random"),
  count: z.number().int().min(1).max(98).default(22),
  durationMinutes: z.number().finite().min(0).max(180).default(35),
  includeAnswered: z.boolean().default(false)
});

export const createReviewModuleSchema = practiceScopeSchema.extend({
  mode: z.enum(["incorrect", "flagged"]),
  count: z.number().int().min(1).max(98).default(22),
  durationMinutes: z.number().finite().min(0).max(180).default(0)
});

const rowIdSchema = z.string().regex(/^(?:math|english):[A-Za-z0-9_-]{1,160}$/);

export const saveAnswerSchema = z.object({
  rowId: rowIdSchema,
  answer: z.string().max(32).default(""),
  flagged: z.boolean().default(false)
}).strict();

export const saveFlagSchema = z.object({
  rowId: rowIdSchema,
  flagged: z.boolean()
}).strict();

export const saveTimeSchema = z.object({
  rowId: rowIdSchema,
  timeSpentSeconds: z.number().int().min(0).max(21_600),
  passIndex: z.number().int().min(0).max(200).default(0),
  passSeconds: z.number().int().min(0).max(21_600).default(0)
}).strict();

export { rowIdSchema };
