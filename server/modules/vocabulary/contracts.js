import { z } from "zod";

export const vocabKindSchema = z.enum(["word", "root"]).default("word");
export const vocabSetSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)
]).nullable().optional();

export const addWordSchema = z.object({
  term: z.string().trim().min(1).max(100),
  definition: z.string().trim().min(1).max(600),
  example: z.string().trim().max(800).default(""),
  setId: vocabSetSchema
}).strict();

export const reviewSchema = z.object({
  itemId: z.number().int().positive(),
  rating: z.enum(["again", "hard", "good", "easy"]),
  setId: vocabSetSchema,
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)
}).strict();

export const vocabQuerySchema = z.object({
  kind: vocabKindSchema,
  set: vocabSetSchema,
  search: z.string().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(30).default(15)
}).strict();

export function vocabQueryFromUrl(url) {
  return {
    kind: url.searchParams.get("kind") || undefined,
    set: url.searchParams.get("set") || undefined,
    search: url.searchParams.get("search") || undefined,
    limit: url.searchParams.get("limit") || undefined
  };
}
