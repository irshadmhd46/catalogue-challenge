import type { Enquiry } from '../../domain/enquiry.js';

export const MAX_SUBJECT_LENGTH = 150;

/** What the transport is asked to send. Plain text only: there is no html, cc, bcc or attachment. */
export interface EnquiryEmail {
  readonly from: string;
  readonly to: string;
  readonly replyTo: { readonly name: string; readonly address: string };
  readonly subject: string;
  readonly text: string;
  readonly headers: { readonly 'X-Enquiry-Id': string };
}

export interface EnquiryEmailAddresses {
  readonly from: string;
  readonly to: string;
}

// C0 controls, DEL and C1 controls. (`\s` below already covers U+2028 and U+2029.)
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const HEADER_BREAKERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** One line, no control characters, single spaces: safe to put in a header. */
export function sanitiseHeader(value: string, maxLength?: number): string {
  const oneLine = value.replace(HEADER_BREAKERS, ' ').replace(/\s+/g, ' ').trim();
  if (maxLength === undefined || oneLine.length <= maxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Builds the sales email. The sender and recipient come from configuration, never from the
 * enquiry; the visitor is only a Reply-To. Everything that reaches a header is sanitised again here
 * even though the request was validated: this function does not trust its caller.
 */
export function buildEnquiryEmail(
  enquiry: Enquiry,
  { from, to }: EnquiryEmailAddresses,
): EnquiryEmail {
  const productTitle = sanitiseHeader(enquiry.product.title);
  const name = sanitiseHeader(enquiry.name);
  const lines = [
    `New enquiry about product ${String(enquiry.product.id)}: ${productTitle}`,
    '',
    `Enquiry ID: ${sanitiseHeader(enquiry.id)}`,
    `Received: ${enquiry.receivedAt.toISOString()}`,
    '',
    `Name: ${name}`,
    `Email: ${enquiry.email}`,
    ...(enquiry.phone === undefined ? [] : [`Phone: ${sanitiseHeader(enquiry.phone)}`]),
    '',
    'Message:',
    enquiry.message,
    '',
  ];

  return {
    from,
    to,
    replyTo: { name, address: enquiry.email },
    subject: sanitiseHeader(
      `Enquiry about product ${String(enquiry.product.id)}: ${productTitle}`,
      MAX_SUBJECT_LENGTH,
    ),
    text: lines.join('\n'),
    headers: { 'X-Enquiry-Id': sanitiseHeader(enquiry.id) },
  };
}
