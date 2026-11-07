import { z } from 'zod';
import { NO_CONTROL_CHARACTERS, PRODUCT_ID_PATTERN } from './requests.js';

export const MAX_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
export const MIN_MESSAGE_LENGTH = 10;
export const MAX_MESSAGE_LENGTH = 2000;

const PHONE = /^[0-9+()\-. ]{5,30}$/;
// Newline, carriage return and tab are fine in a message; every other control character is not.
const MESSAGE_CONTROL_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/;

export const enquiryRequestSchema = z
  .object({
    productId: z
      .number()
      .int()
      .positive()
      .refine(
        (id) => PRODUCT_ID_PATTERN.test(String(id)),
        'must be a whole number of at most 9 digits',
      ),
    name: z
      .string()
      .trim()
      .min(1, 'must not be blank')
      .max(MAX_NAME_LENGTH, `must be at most ${String(MAX_NAME_LENGTH)} characters`)
      .regex(NO_CONTROL_CHARACTERS, 'must be a single line without control characters'),
    email: z
      .string()
      .trim()
      .max(MAX_EMAIL_LENGTH, `must be at most ${String(MAX_EMAIL_LENGTH)} characters`)
      .pipe(z.email('must be a valid email address')),
    phone: z
      .string()
      .trim()
      .regex(PHONE, 'must be 5 to 30 characters: digits, spaces or + ( ) - .')
      .optional(),
    message: z
      .string()
      .trim()
      .min(MIN_MESSAGE_LENGTH, `must be at least ${String(MIN_MESSAGE_LENGTH)} characters`)
      .max(MAX_MESSAGE_LENGTH, `must be at most ${String(MAX_MESSAGE_LENGTH)} characters`)
      .refine(
        (text) => !MESSAGE_CONTROL_CHARACTERS.test(text),
        'must not contain control characters',
      ),
  })
  .strict();

export const enquiryResponseSchema = z
  .object({
    enquiryId: z.uuid(),
    status: z.literal('accepted'),
  })
  .strict();

export type EnquiryRequest = z.infer<typeof enquiryRequestSchema>;
export type EnquiryResponse = z.infer<typeof enquiryResponseSchema>;
