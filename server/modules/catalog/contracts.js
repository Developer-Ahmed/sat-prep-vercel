import { z } from "zod";

export const subjectSchema = z.enum(["math", "english"]).default("math");
export const poolSchema = z.literal("main").default("main");

export const catalogScopeSchema = z.object({
  subject: subjectSchema,
  pool: poolSchema
}).strict();

export function catalogScopeFromUrl(url) {
  return {
    subject: url.searchParams.get("subject") || undefined,
    pool: url.searchParams.get("pool") || undefined
  };
}
