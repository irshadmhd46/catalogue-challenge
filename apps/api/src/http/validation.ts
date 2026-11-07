import type { z } from 'zod';
import { ValidationError, type FieldIssue } from '../domain/errors.js';

const WHOLE_REQUEST = 'request';

function toFieldIssue(issue: z.core.$ZodIssue): FieldIssue {
  // Unknown-key messages would echo caller-chosen names, so they get a fixed message instead.
  if (issue.code === 'unrecognized_keys') {
    return { field: WHOLE_REQUEST, message: 'contains parameters that are not allowed' };
  }
  const field = issue.path.map(String).join('.');
  return { field: field === '' ? WHOLE_REQUEST : field, message: issue.message };
}

/** Validates request input before it reaches a service. Never echoes the submitted values. */
export function parseRequest<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  // One detail per field: a value can break several rules at once, and the first is enough.
  const byField = new Map<string, FieldIssue>();
  for (const issue of result.error.issues.map(toFieldIssue)) {
    if (!byField.has(issue.field)) {
      byField.set(issue.field, issue);
    }
  }
  throw new ValidationError({ details: [...byField.values()] });
}
