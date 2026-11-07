import { describe, expect, it } from 'vitest';
import {
  enquiryPaths,
  enquiryRequestSchema,
  enquiryResponseSchema,
  type EnquiryRequest,
} from '../src/index.js';

const valid: EnquiryRequest = {
  productId: 7,
  name: 'Ann Lee',
  email: 'ann@example.test',
  phone: '+44 (0)20 7946 0958',
  message: 'Is this ring available in size 7?',
};

/** A syntactically valid address of exactly `length` characters (local part 64, labels up to 63). */
function emailOfLength(length: number): string {
  const local = 'a'.repeat(64);
  const tld = '.co';
  let rest = length - local.length - 1 - tld.length; // characters left for the domain labels
  const labels: string[] = [];
  while (rest > 0) {
    const take = Math.min(rest, 63);
    labels.push('b'.repeat(take));
    rest -= take + 1; // the dot between labels
  }
  const address = `${local}@${labels.join('.')}${tld}`;
  if (address.length !== length)
    throw new Error(`built ${String(address.length)}, wanted ${String(length)}`);
  return address;
}

const parse = (override: Record<string, unknown>) =>
  enquiryRequestSchema.safeParse({ ...valid, ...override });
const without = (key: string) =>
  Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));

describe('enquiryRequestSchema: valid input', () => {
  it('parses a full enquiry unchanged', () => {
    expect(enquiryRequestSchema.parse(valid)).toEqual(valid);
  });

  it('trims every text field', () => {
    const parsed = enquiryRequestSchema.parse({
      ...valid,
      name: '  Ann Lee ',
      email: ' ann@example.test ',
      phone: ' 0123456789 ',
      message: '  Is this ring available in size 7?  ',
    });

    expect(parsed).toMatchObject({
      name: 'Ann Lee',
      email: 'ann@example.test',
      phone: '0123456789',
      message: 'Is this ring available in size 7?',
    });
  });

  it('accepts an enquiry without a phone', () => {
    const parsed = enquiryRequestSchema.safeParse(without('phone'));

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('phone');
  });

  it('accepts a multi-line message with tabs', () => {
    expect(
      parse({ message: 'Line one is here.\r\nLine two:\tindented.\nLine three.' }).success,
    ).toBe(true);
  });

  it('trims a pasted trailing newline from the email', () => {
    expect(enquiryRequestSchema.parse({ ...valid, email: '  ann@example.test\n' }).email).toBe(
      'ann@example.test',
    );
  });

  it.each([
    ['name of 100 characters', { name: 'n'.repeat(100) }],
    ['email of 254 characters', { email: emailOfLength(254) }],
    ['message of 10 characters', { message: '0123456789' }],
    ['message of 2000 characters', { message: 'm'.repeat(2000) }],
    ['phone of 5 characters', { phone: '12345' }],
    ['phone of 30 characters', { phone: '1'.repeat(30) }],
    ['product id of 9 digits', { productId: 999_999_999 }],
    ['product id 1', { productId: 1 }],
  ])('accepts a %s', (_label, override) => {
    expect(parse(override).success).toBe(true);
  });
});

describe('enquiryRequestSchema: boundaries just past the limit', () => {
  it.each([
    ['name of 101 characters', { name: 'n'.repeat(101) }],
    ['email of 255 characters', { email: emailOfLength(255) }],
    ['message of 9 characters', { message: '012345678' }],
    ['message of 2001 characters', { message: 'm'.repeat(2001) }],
    ['phone of 4 characters', { phone: '1234' }],
    ['phone of 31 characters', { phone: '1'.repeat(31) }],
    ['product id of 10 digits', { productId: 1_234_567_890 }],
  ])('rejects a %s', (_label, override) => {
    expect(parse(override).success).toBe(false);
  });

  it('counts the message length after trimming', () => {
    expect(parse({ message: '   short   ' }).success).toBe(false);
  });
});

describe('enquiryRequestSchema: emails that are not a plain address', () => {
  it.each([
    'a@b',
    'a@b.co, c@d.co',
    '"x" <a@b.co>',
    '<a@b.co>',
    'a b@c.co',
    'a@b.co\r\nBcc: x@y.z',
    'a@b.co\r\n x@y.z',
    'a@b.co\nBcc: x@y.z',
    '@b.co',
    'a@@b.co',
    'a@b..co',
    '',
    '   ',
  ])('rejects %j', (email) => {
    expect(parse({ email }).success).toBe(false);
  });
});

describe('enquiryRequestSchema: control characters and other bad values', () => {
  it.each([
    ['a newline in the name', { name: 'Ann\nLee' }],
    ['a carriage return in the name', { name: 'Ann\rLee' }],
    ['a tab in the name', { name: 'Ann\tLee' }],
    ['a NUL in the name', { name: 'Ann\u0000Lee' }],
    ['a blank name', { name: '   ' }],
    ['a C1 control in the name', { name: 'Ann\u0085Lee' }],
    ['a line separator in the name', { name: 'Ann\u2028Lee' }],
    ['a paragraph separator in the name', { name: 'Ann\u2029Lee' }],
    ['a NUL in the message', { message: 'Is this ring\u0000 available?' }],
    ['an escape character in the message', { message: 'Is this ring\u001b[31m available?' }],
    ['a DEL in the message', { message: 'Is this ring\u007f available?' }],
    ['a C1 control in the message', { message: 'Is this ring\u0085 available?' }],
    ['a line separator in the message', { message: 'Is this ring\u2028 available?' }],
    ['a letter in the phone', { phone: '0123 call me' }],
    ['an empty phone', { phone: '' }],
    ['a newline in the phone', { phone: '01234\n56789' }],
    ['a string product id', { productId: '7' }],
    ['a fractional product id', { productId: 1.5 }],
    ['product id 0', { productId: 0 }],
    ['a negative product id', { productId: -1 }],
    ['a non-string name', { name: 42 }],
    ['a null email', { email: null }],
  ])('rejects %s', (_label, override) => {
    expect(parse(override).success).toBe(false);
  });

  it.each(['productId', 'name', 'email', 'message'])('rejects a missing %s', (field) => {
    expect(enquiryRequestSchema.safeParse(without(field)).success).toBe(false);
  });

  it.each(['to', 'cc', 'bcc', 'from', 'subject', 'replyTo', 'headers'])(
    'rejects an extra %s property so a caller cannot choose recipients or headers',
    (extra) => {
      expect(parse({ [extra]: 'x@y.z' }).success).toBe(false);
    },
  );

  it.each([null, [], 'text', 42, undefined])('rejects a non-object body %j', (body) => {
    expect(enquiryRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('enquiryRequestSchema: messages never echo the input', () => {
  it('keeps submitted values out of every issue message', () => {
    const result = enquiryRequestSchema.safeParse({
      productId: 7,
      name: 'Secret Person\nName',
      email: 'hunter2@',
      phone: 'private phone',
      message: 'tiny',
    });

    expect(result.success).toBe(false);
    const issues = JSON.stringify(result.error?.issues);
    for (const secret of ['Secret Person', 'hunter2', 'private phone', 'tiny']) {
      expect(issues).not.toContain(secret);
    }
  });

  it('names each invalid field', () => {
    const result = parse({ email: 'nope', message: 'short' });

    const fields = result.error?.issues.map((issue) => issue.path[0]);
    expect(fields).toContain('email');
    expect(fields).toContain('message');
  });
});

describe('enquiryResponseSchema', () => {
  const body = { enquiryId: '0b1f6a3e-4c2d-4e8a-9f1b-2d3c4b5a6978', status: 'accepted' } as const;

  it('accepts an accepted response', () => {
    expect(enquiryResponseSchema.parse(body)).toEqual(body);
  });

  it.each([
    ['a non-UUID id', { ...body, enquiryId: '123' }],
    ['another status', { ...body, status: 'sent' }],
    ['an extra property', { ...body, email: 'ann@example.test' }],
    ['a missing id', { status: 'accepted' }],
  ])('rejects %s', (_label, value) => {
    expect(enquiryResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe('enquiryPaths', () => {
  it('has the create route relative to the API prefix', () => {
    expect(enquiryPaths).toEqual({ create: '/enquiries' });
  });
});
