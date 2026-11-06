import type { Enquiry } from './enquiry.js';

/**
 * Delivers an enquiry to the sales team. Implementations throw `NotificationError` on failure and
 * never retry: a retry could deliver the same enquiry twice.
 */
export interface EnquiryNotifier {
  send(enquiry: Enquiry): Promise<void>;
}
