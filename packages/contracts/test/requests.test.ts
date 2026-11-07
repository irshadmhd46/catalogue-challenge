import { describe, expect, it } from 'vitest';
import {
  categorySlugParamsSchema,
  productIdParamsSchema,
  searchQuerySchema,
} from '../src/index.js';

function issueText(result: { success: boolean; error?: { issues: unknown[] } }): string {
  return JSON.stringify(result.error?.issues ?? []);
}

describe('productIdParamsSchema', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['999999999', 999_999_999],
  ])('parses %s as the number %i', (raw, expected) => {
    expect(productIdParamsSchema.parse({ id: raw })).toEqual({ id: expected });
  });

  it.each(['0', '-1', '1e3', ' 5', '5 ', 'abc', '', '007', '1234567890', '1.5', '+5', '0x10'])(
    'rejects the id %j',
    (raw) => {
      expect(productIdParamsSchema.safeParse({ id: raw }).success).toBe(false);
    },
  );

  it('rejects a missing id and unknown properties', () => {
    expect(productIdParamsSchema.safeParse({}).success).toBe(false);
    expect(productIdParamsSchema.safeParse({ id: '1', extra: 'x' }).success).toBe(false);
  });

  it('never echoes the submitted value in its messages', () => {
    const result = productIdParamsSchema.safeParse({ id: 'hunter2' });

    expect(result.success).toBe(false);
    expect(issueText(result)).not.toContain('hunter2');
  });
});

describe('categorySlugParamsSchema', () => {
  it.each(['electronics', 'mens-clothing', 'a1', 'a-b-c', 'x'.repeat(64)])(
    'accepts the slug %s',
    (slug) => {
      expect(categorySlugParamsSchema.parse({ slug })).toEqual({ slug });
    },
  );

  it.each(['Men', 'a b', '-x', 'x-', 'a--b', '../x', 'x/y', "men's", '', 'x'.repeat(65), 'é'])(
    'rejects the slug %j',
    (slug) => {
      expect(categorySlugParamsSchema.safeParse({ slug }).success).toBe(false);
    },
  );

  it('never echoes the submitted value in its messages', () => {
    const result = categorySlugParamsSchema.safeParse({ slug: '../etc/passwd' });

    expect(issueText(result)).not.toContain('passwd');
  });
});

describe('searchQuerySchema', () => {
  it('trims the query', () => {
    expect(searchQuerySchema.parse({ q: '  backpack ' })).toEqual({ q: 'backpack' });
  });

  it('accepts exactly 100 characters and rejects 101', () => {
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
  });

  it('keeps inner spaces and punctuation', () => {
    expect(searchQuerySchema.parse({ q: "men's  jacket (xl)" })).toEqual({
      q: "men's  jacket (xl)",
    });
  });

  it.each([
    ['blank', ''],
    ['whitespace only', '   '],
    ['newline inside', 'a\nb'],
    ['tab inside', 'a\tb'],
    ['NUL inside', 'a\u0000b'],
    ['DEL inside', 'a\u007fb'],
  ])('rejects a %s query', (_label, q) => {
    expect(searchQuerySchema.safeParse({ q }).success).toBe(false);
  });

  it('rejects a missing, repeated or non-string q', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: ['a', 'b'] }).success).toBe(false);
  });

  it('rejects unknown query parameters', () => {
    expect(searchQuerySchema.safeParse({ q: 'bag', sort: 'price' }).success).toBe(false);
  });

  it('never echoes the submitted value in its messages', () => {
    const result = searchQuerySchema.safeParse({ q: 'x'.repeat(100) + 'SECRET-TAIL' });

    expect(result.success).toBe(false);
    expect(issueText(result)).not.toContain('SECRET-TAIL');
  });
});
