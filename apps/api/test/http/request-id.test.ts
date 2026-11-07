import { describe, expect, it } from 'vitest';
import { resolveRequestId } from '../../src/http/request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each(['abc-123', 'a', 'req_1.2:3', 'A'.repeat(64)])('echoes the valid id %s', (id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it('generates a UUID when no id is supplied', () => {
    expect(resolveRequestId(undefined)).toMatch(UUID);
  });

  it.each([
    ['contains a space', 'abc 123'],
    ['contains a newline', 'abc\n123'],
    ['contains a comma (duplicated header)', 'abc, def'],
    ['is 65 characters long', 'A'.repeat(65)],
    ['is empty', ''],
    ['is not a string', ['abc']],
  ])('replaces an id that %s', (_label, value) => {
    const id = resolveRequestId(value);

    expect(id).toMatch(UUID);
    expect(id).not.toBe(value);
  });

  it('generates a different id each time', () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});
