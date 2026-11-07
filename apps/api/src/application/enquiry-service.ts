import type { EnquiryRequest } from '@catalogue/contracts';
import type { Enquiry } from '../domain/enquiry.js';
import type { EnquiryNotifier } from '../domain/enquiry-notifier.js';
import { NotificationError } from '../domain/errors.js';
import type { Logger } from '../domain/logger.js';
import type { CatalogService } from './catalog-service.js';

export class EnquiryService {
  constructor(
    private readonly catalog: Pick<CatalogService, 'find'>,
    private readonly notifier: EnquiryNotifier,
    private readonly logger: Logger,
    private readonly newId: () => string,
    private readonly now: () => Date,
  ) {}

  /** Sends one enquiry to the sales team and resolves to its id. Never retries. */
  async submit(request: EnquiryRequest): Promise<string> {
    // An unknown product stops here, before an id is spent or anything is sent. The title comes
    // from the catalogue: the request cannot choose what appears in the email.
    const product = await this.catalog.find(request.productId);

    const enquiry: Enquiry = {
      id: this.newId(),
      receivedAt: this.now(),
      product: { id: product.id, title: product.title },
      name: request.name,
      email: request.email,
      ...(request.phone === undefined ? {} : { phone: request.phone }),
      message: request.message,
    };

    try {
      await this.notifier.send(enquiry);
    } catch (cause) {
      // Not logged here: the central error handler logs the failure once.
      throw new NotificationError({ cause, enquiryId: enquiry.id });
    }

    this.logger.info(
      { enquiryId: enquiry.id, productId: product.id, outcome: 'sent' },
      'enquiry sent',
    );
    return enquiry.id;
  }
}
