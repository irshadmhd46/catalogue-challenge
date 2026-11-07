import type { Enquiry } from './enquiry.js';

/**
 * Delivers an enquiry to the sales team. Implementations never retry (a retry could deliver the
 * same enquiry twice) and throw a `NotificationError` on failure whose `cause` carries no personal
 * data: the central error handler logs the whole cause chain, so a raw library error that echoes
 * the visitor's address or message must be rebuilt before it is thrown.
 */
export interface EnquiryNotifier {
  send(enquiry: Enquiry): Promise<void>;
}
