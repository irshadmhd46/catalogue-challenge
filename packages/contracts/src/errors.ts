import { z } from 'zod';

/**
 * Every error response from the API has this shape. The client parses it with this schema, so the
 * server and the web app agree on one definition. Not strict: a new optional field must not break
 * an older client.
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
