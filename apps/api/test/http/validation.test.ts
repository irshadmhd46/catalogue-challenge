import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../../src/domain/errors.js';
import { parseRequest } from '../../src/http/validation.js';

function failure(run: () => unknown): ValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error('expected a ValidationError');
}

describe('parseRequest', () => {
  const schema = z
    .object({ id: z.string().regex(/^\d+$/, 'must be digits').transform(Number) })
    .strict();

  it('returns the parsed, transformed value', () => {
    expect(parseRequest(schema, { id: '42' })).toEqual({ id: 42 });
  });

  it('throws a ValidationError with the field name and a message', () => {
    const error = failure(() => parseRequest(schema, { id: 'abc' }));

    expect(error.httpStatus).toBe(400);
    expect(error.details).toEqual([{ field: 'id', message: 'must be digits' }]);
  });

  it('uses a dotted path for nested fields', () => {
    const nested = z.object({ filter: z.object({ min: z.number() }) });

    const error = failure(() => parseRequest(nested, { filter: { min: 'x' } }));

    expect(error.details?.[0]?.field).toBe('filter.min');
  });

  it('names the whole request when the problem is not tied to a field', () => {
    const error = failure(() => parseRequest(schema, 'not an object'));

    expect(error.details?.[0]?.field).toBe('request');
  });

  it('reports a missing field by name', () => {
    const error = failure(() => parseRequest(schema, {}));

    expect(error.details?.map((d) => d.field)).toEqual(['id']);
  });

  it('reports unknown parameters with a fixed message that does not echo their names', () => {
    const error = failure(() => parseRequest(schema, { id: '1', 'evil<script>': 'x' }));

    expect(error.details).toEqual([
      { field: 'request', message: 'contains parameters that are not allowed' },
    ]);
    expect(JSON.stringify(error.details)).not.toContain('evil');
  });

  it('never includes the submitted value in the details', () => {
    const error = failure(() => parseRequest(schema, { id: 'hunter2' }));

    expect(JSON.stringify(error.details)).not.toContain('hunter2');
  });

  it('reports a field once even when its value breaks several rules', () => {
    const strict = z.object({
      q: z
        .string()
        .min(2, 'too short')
        .regex(/^[a-z]+$/, 'letters only'),
    });

    const error = failure(() => parseRequest(strict, { q: '' }));

    expect(error.details).toEqual([{ field: 'q', message: 'too short' }]);
  });

  it('reports every failing field once', () => {
    const two = z.object({ a: z.string(), b: z.string() });

    const error = failure(() => parseRequest(two, {}));

    expect(error.details?.map((d) => d.field).sort()).toEqual(['a', 'b']);
  });
});
