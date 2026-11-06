import type { Enquiry } from '../../domain/enquiry.js';
import type { EnquiryNotifier } from '../../domain/enquiry-notifier.js';
import { NotificationError } from '../../domain/errors.js';
import { buildEnquiryEmail, type EnquiryEmail } from './enquiry-email.js';

/** The two nodemailer transport methods this adapter uses, so tests never open a socket. */
export interface MailTransport {
  sendMail(message: EnquiryEmail): Promise<unknown>;
  close(): void;
}

export interface SmtpEnquiryNotifierOptions {
  readonly from: string;
  readonly to: string;
  /** Total time one send may take, whatever the transport's own timeouts do. */
  readonly timeoutMs: number;
}

class SmtpDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`smtp send timed out after ${String(timeoutMs)} ms`);
    this.name = 'SmtpDeadlineError';
  }
}

// Short identifiers only: a code, command or status the server or library chose is never trusted
// to be free text.
const SHORT_IDENTIFIER = /^[A-Za-z0-9_]{1,40}$/;

/**
 * Rebuilds a failure from its code, command and response status only. The raw server response and
 * the library message can echo addresses or message fragments, so they are dropped.
 */
export function describeSmtpFailure(error: unknown): Error {
  if (error instanceof SmtpDeadlineError) {
    return error;
  }
  const parts: string[] = [];
  if (typeof error === 'object' && error !== null) {
    const { code, command, responseCode } = error as Record<string, unknown>;
    if (typeof code === 'string' && SHORT_IDENTIFIER.test(code)) parts.push(code);
    if (typeof command === 'string' && SHORT_IDENTIFIER.test(command)) parts.push(command);
    if (
      Number.isInteger(responseCode) &&
      (responseCode as number) >= 100 &&
      (responseCode as number) <= 599
    ) {
      parts.push(String(responseCode));
    }
  }
  return new Error(parts.length > 0 ? `smtp send failed: ${parts.join(' ')}` : 'smtp send failed');
}

export class SmtpEnquiryNotifier implements EnquiryNotifier {
  constructor(
    private readonly transport: MailTransport,
    private readonly options: SmtpEnquiryNotifierOptions,
  ) {}

  /** One attempt, never retried: a retry could deliver the same enquiry twice. */
  async send(enquiry: Enquiry): Promise<void> {
    const message = buildEnquiryEmail(enquiry, this.options);
    try {
      await this.withDeadline(() => this.transport.sendMail(message));
    } catch (error) {
      throw new NotificationError({ cause: describeSmtpFailure(error) });
    }
  }

  close(): void {
    this.transport.close();
  }

  private async withDeadline(send: () => Promise<unknown>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new SmtpDeadlineError(this.options.timeoutMs));
      }, this.options.timeoutMs);
    });

    try {
      // `race` handles both promises, so a transport failure after the deadline is not unhandled.
      await Promise.race([send(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
