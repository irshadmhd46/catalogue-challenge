import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** Echo a well-formed caller id, otherwise mint one. The raw header is never trusted. */
export function resolveRequestId(header: unknown): string {
  if (typeof header === 'string' && VALID_REQUEST_ID.test(header)) {
    return header;
  }
  return randomUUID();
}
