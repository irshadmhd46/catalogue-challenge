import { z } from 'zod';

export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_SLUG_LENGTH = 64;

// No leading zero and at most 9 digits: the value always fits a double exactly.
export const PRODUCT_ID_PATTERN = /^[1-9][0-9]{0,8}$/;
const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
export const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001f\u007f]+$/;

export const productIdParamsSchema = z
  .object({
    id: z
      .string()
      .regex(PRODUCT_ID_PATTERN, 'must be a positive whole number of at most 9 digits')
      .transform(Number),
  })
  .strict();

export const categorySlugParamsSchema = z
  .object({
    slug: z
      .string()
      .max(MAX_SLUG_LENGTH, `must be at most ${String(MAX_SLUG_LENGTH)} characters`)
      .regex(CATEGORY_SLUG, 'must be lowercase letters and digits separated by single hyphens'),
  })
  .strict();

export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(1, 'must not be blank')
      .max(MAX_SEARCH_QUERY_LENGTH, `must be at most ${String(MAX_SEARCH_QUERY_LENGTH)} characters`)
      .regex(NO_CONTROL_CHARACTERS, 'must not contain control characters'),
  })
  .strict();

export type ProductIdParams = z.infer<typeof productIdParamsSchema>;
export type CategorySlugParams = z.infer<typeof categorySlugParamsSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
