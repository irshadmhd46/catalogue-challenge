import { describe, expect, it } from 'vitest';
import { errorEnvelopeSchema } from '../src/index.js';

const envelope = { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req-1' } };

describe('errorEnvelopeSchema', () => {
  it('parses an envelope without details', () => {
    expect(errorEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it('parses field details', () => {
    const withDetails = {
      error: { ...envelope.error, details: [{ field: 'email', message: 'Invalid email' }] },
    };

    expect(errorEnvelopeSchema.parse(withDetails)).toEqual(withDetails);
  });

  it('accepts an extra field so a newer server does not break an older client', () => {
    const parsed = errorEnvelopeSchema.safeParse({ error: { ...envelope.error, retryable: true } });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['a missing code', { error: { message: 'x', requestId: 'r' } }],
    ['an empty code', { error: { code: '', message: 'x', requestId: 'r' } }],
    ['a missing request id', { error: { code: 'X', message: 'x' } }],
    ['malformed details', { error: { ...envelope.error, details: ['email'] } }],
    ['a body without an error key', { message: 'x' }],
    ['null', null],
    ['an html page', '<html>502</html>'],
  ])('rejects %s', (_label, body) => {
    expect(errorEnvelopeSchema.safeParse(body).success).toBe(false);
  });
});
