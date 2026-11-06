import { describe, expect, it } from 'vitest';
import type { Enquiry } from '../../src/domain/enquiry.js';
import {
  MAX_SUBJECT_LENGTH,
  buildEnquiryEmail,
  sanitiseHeader,
} from '../../src/infrastructure/mail/enquiry-email.js';

const ADDRESSES = { from: 'no-reply@shop.example.test', to: 'sales@shop.example.test' };

const ENQUIRY: Enquiry = {
  id: '0b1f6a3e-4c2d-4e8a-9f1b-2d3c4b5a6978',
  receivedAt: new Date('2026-11-06T10:00:00Z'),
  product: { id: 7, title: 'Gold Ring' },
  name: 'Ann Lee',
  email: 'ann@example.test',
  phone: '+44 20 7946 0958',
  message: 'Is this ring available in size 7?\nThanks!',
};

const build = (override: Partial<Enquiry> = {}) =>
  buildEnquiryEmail({ ...ENQUIRY, ...override }, ADDRESSES);

// Every way a header line can end, or a header can be smuggled in.
/** True if the value contains anything that can end a header line or hide a new one. */
function hasLineBreak(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });
}

const LINE_BREAKS = [
  '\r\n',
  '\n',
  '\r',
  '\u2028',
  '\u2029',
  '\u0085',
  '\u000b',
  '\u000c',
  '\u0000',
];

describe('sanitiseHeader', () => {
  it.each([
    ['Ann Lee', 'Ann Lee'],
    ['  padded   spaces  ', 'padded spaces'],
    ['tab\there', 'tab here'],
    ['a\r\nBcc: x@evil.test', 'a Bcc: x@evil.test'],
    ['nul\u0000byte', 'nul byte'],
    ['bell\u0007here', 'bell here'],
    ['shift-out\u000ehere', 'shift-out here'],
    ['escape\u001b[31mhere', 'escape [31mhere'],
    ['unit-sep\u001fhere', 'unit-sep here'],
    ['del\u007fchar', 'del char'],
    ['c1\u0085control', 'c1 control'],
    ['para\u2029sep', 'para sep'],
    ['line\u2028sep', 'line sep'],
    ['', ''],
    ['\r\n\r\n', ''],
  ])('%j -> %j', (input, expected) => {
    expect(sanitiseHeader(input)).toBe(expected);
  });

  it('truncates to the limit with an ellipsis, never exceeding it', () => {
    const result = sanitiseHeader('x'.repeat(500), 150);

    expect(result).toHaveLength(150);
    expect(result.endsWith('…')).toBe(true);
  });

  it('leaves a value exactly at the limit alone', () => {
    expect(sanitiseHeader('y'.repeat(150), 150)).toBe('y'.repeat(150));
  });

  it('does not truncate when no limit is given', () => {
    expect(sanitiseHeader('z'.repeat(500))).toHaveLength(500);
  });
});

describe('buildEnquiryEmail: addresses', () => {
  it('uses the configured sender and the sales inbox', () => {
    const email = build();

    expect(email.from).toBe('no-reply@shop.example.test');
    expect(email.to).toBe('sales@shop.example.test');
  });

  it('puts the visitor only in Reply-To', () => {
    const email = build({ email: 'attacker@example.test' });

    expect(email.replyTo).toEqual({ name: 'Ann Lee', address: 'attacker@example.test' });
    expect(email.from).not.toContain('attacker');
    expect(email.to).not.toContain('attacker');
  });

  it('has exactly these fields: no cc, bcc, html or attachments', () => {
    expect(Object.keys(build()).sort()).toEqual([
      'from',
      'headers',
      'replyTo',
      'subject',
      'text',
      'to',
    ]);
  });

  it('adds only the enquiry id header', () => {
    expect(build().headers).toEqual({ 'X-Enquiry-Id': ENQUIRY.id });
  });
});

describe('buildEnquiryEmail: the enquiry id header', () => {
  it('cannot carry a line break even if the id is hostile', () => {
    const email = build({ id: 'abc\r\nBcc: x@evil.test' });

    expect(hasLineBreak(email.headers['X-Enquiry-Id'])).toBe(false);
    expect(email.headers['X-Enquiry-Id']).toBe('abc Bcc: x@evil.test');
  });
});

describe('buildEnquiryEmail: subject', () => {
  it('has the documented format', () => {
    expect(build({ product: { id: 7, title: 'Backpack' } }).subject).toBe(
      'Enquiry about product 7: Backpack',
    );
  });

  it(`is at most ${String(MAX_SUBJECT_LENGTH)} characters for a 500-character title`, () => {
    const email = build({ product: { id: 7, title: 'T'.repeat(500) } });

    expect(email.subject).toHaveLength(MAX_SUBJECT_LENGTH);
    expect(email.subject.endsWith('…')).toBe(true);
  });

  it.each(LINE_BREAKS)('has no line break from %j in the product title', (breaker) => {
    const email = build({ product: { id: 7, title: `Widget${breaker}Subject: spam X` } });

    expect(hasLineBreak(email.subject)).toBe(false);
    expect(email.subject).toContain('Widget');
  });
});

describe('buildEnquiryEmail: header injection through the visitor name', () => {
  it.each(LINE_BREAKS)('cannot start a new header with %j', (breaker) => {
    const email = build({ name: `Ann${breaker}Bcc: x@evil.test` });

    expect(hasLineBreak(email.replyTo.name)).toBe(false);
    expect(JSON.stringify(email.headers)).not.toContain('evil');
    expect(email.to).toBe(ADDRESSES.to);
  });

  it('keeps the visible part of the name', () => {
    expect(build({ name: 'Ann\r\nLee' }).replyTo.name).toBe('Ann Lee');
  });

  it('does not let the name end up in the subject', () => {
    expect(build({ name: 'Ann Lee' }).subject).not.toContain('Ann');
  });
});

describe('buildEnquiryEmail: body', () => {
  it('contains the enquiry id, product, name, email and phone', () => {
    const { text } = build();

    expect(text).toContain(`Enquiry ID: ${ENQUIRY.id}`);
    expect(text).toContain('product 7: Gold Ring');
    expect(text).toContain('Name: Ann Lee');
    expect(text).toContain('Email: ann@example.test');
    expect(text).toContain('Phone: +44 20 7946 0958');
    expect(text).toContain('Received: 2026-11-06T10:00:00.000Z');
  });

  it('keeps a multi-line message exactly as written', () => {
    expect(build().text).toContain('Message:\nIs this ring available in size 7?\nThanks!\n');
  });

  it('omits the phone line when there is no phone', () => {
    const withoutPhone: Enquiry = {
      id: ENQUIRY.id,
      receivedAt: ENQUIRY.receivedAt,
      product: ENQUIRY.product,
      name: ENQUIRY.name,
      email: ENQUIRY.email,
      message: ENQUIRY.message,
    };

    const { text } = buildEnquiryEmail(withoutPhone, ADDRESSES);

    expect(text).not.toContain('Phone:');
  });

  it('shows HTML in the message verbatim as text', () => {
    const { text } = build({ message: 'Hi <script>alert(1)</script> <b>bold</b>' });

    expect(text).toContain('<script>alert(1)</script> <b>bold</b>');
  });

  it('puts a message that looks like headers in the body, never in the headers', () => {
    const email = build({ message: 'ok\r\nBcc: x@evil.test\r\nSubject: hijack' });

    expect(email.text).toContain('Bcc: x@evil.test');
    expect(JSON.stringify({ ...email, text: undefined })).not.toContain('evil');
    expect(email.subject).not.toContain('hijack');
  });

  it('keeps the product title on one line in the body', () => {
    const { text } = build({ product: { id: 7, title: 'Widget\r\nBcc: x@evil.test' } });

    expect(text.split('\n')[0]).toBe('New enquiry about product 7: Widget Bcc: x@evil.test');
  });

  it('keeps the name and phone on one line in the body', () => {
    const { text } = build({ name: 'Ann\nBcc: x', phone: '01234\n56789' });

    expect(text).toContain('Name: Ann Bcc: x\n');
    expect(text).toContain('Phone: 01234 56789\n');
  });
});
