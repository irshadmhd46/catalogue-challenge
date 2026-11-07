import {
  API_PREFIX,
  enquiryPaths,
  enquiryRequestSchema,
  type EnquiryResponse,
} from '@catalogue/contracts';
import type { FastifyInstance } from 'fastify';
import type { EnquiryService } from '../application/enquiry-service.js';
import { parseRequest } from './validation.js';

const ACCEPTED = 202;

export function registerEnquiryRoutes(app: FastifyInstance, enquiries: EnquiryService): void {
  app.post(
    `${API_PREFIX}${enquiryPaths.create}`,
    { config: { rateScope: 'enquiry' } },
    async (request, reply): Promise<EnquiryResponse> => {
      const enquiry = parseRequest(enquiryRequestSchema, request.body);
      const enquiryId = await enquiries.submit(enquiry);
      void reply.status(ACCEPTED);
      return { enquiryId, status: 'accepted' };
    },
  );
}
