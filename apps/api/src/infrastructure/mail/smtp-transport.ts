import nodemailer from 'nodemailer';
import type { EnquiryEmail } from './enquiry-email.js';
import type { MailTransport } from './smtp-enquiry-notifier.js';

export interface SmtpTransportConfig {
  readonly host: string;
  readonly port: number;
  /** none: local sink as-is; starttls: upgrade or fail; tls: TLS from the first byte. */
  readonly tls: 'none' | 'starttls' | 'tls';
  readonly user: string | undefined;
  /** A secret: never log it, never put it in an error. */
  readonly password: string | undefined;
  readonly timeoutMs: number;
}

/** The nodemailer options for a config. Pure, so the security-relevant choices are testable. */
export function buildSmtpOptions(config: SmtpTransportConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.tls === 'tls',
    requireTLS: config.tls === 'starttls',
    ignoreTLS: config.tls === 'none',
    ...(config.tls === 'none'
      ? {}
      : { tls: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } }),
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    // A fresh connection per enquiry: volume is low and a pool would hide a dead connection.
    pool: false,
    // The SMTP conversation would contain credentials and the visitor's details.
    logger: false,
    debug: false,
    // The email has no attachments or linked content, so nothing may read files or URLs for it.
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(config.user !== undefined && config.password !== undefined
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
  };
}

export function createSmtpTransport(config: SmtpTransportConfig): MailTransport {
  const transporter = nodemailer.createTransport(buildSmtpOptions(config));
  return {
    sendMail: (message: EnquiryEmail) => transporter.sendMail(message),
    close: () => {
      transporter.close();
    },
  };
}
