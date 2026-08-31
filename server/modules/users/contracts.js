import { z } from "zod";
import { practiceScopeSchema } from "../practice/contracts.js";

export const resetProgressSchema = practiceScopeSchema.strict();

export const webhookReceiptSchema = z.object({
  eventId: z.string().regex(/^[A-Za-z0-9_-]{8,200}$/),
  eventType: z.string().regex(/^[a-z][a-z0-9_.]{2,100}$/),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  userId: z.string().regex(/^user_[A-Za-z0-9_-]{1,120}$/).nullable()
}).strict();
