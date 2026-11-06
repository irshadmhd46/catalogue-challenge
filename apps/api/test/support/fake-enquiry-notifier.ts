import type { Enquiry } from '../../src/domain/enquiry.js';
import type { EnquiryNotifier } from '../../src/domain/enquiry-notifier.js';

export class FakeEnquiryNotifier implements EnquiryNotifier {
  readonly sent: Enquiry[] = [];
  /** When set, `send` rejects with it instead of recording. */
  failure: unknown;

  send(enquiry: Enquiry): Promise<void> {
    if (this.failure !== undefined) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- tests reject with non-Errors on purpose
      return Promise.reject(this.failure);
    }
    this.sent.push(enquiry);
    return Promise.resolve();
  }
}
