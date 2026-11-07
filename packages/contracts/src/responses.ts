import { z } from 'zod';
import { categorySchema, productSchema } from './catalog.js';

export const featuredResponseSchema = z.object({ products: z.array(productSchema) }).strict();

export const categoriesResponseSchema = z.object({ categories: z.array(categorySchema) }).strict();

export const categoryPageResponseSchema = z
  .object({
    category: categorySchema,
    topRated: z.array(productSchema),
    more: z.array(productSchema),
  })
  .strict();

export const searchResponseSchema = z
  .object({ query: z.string(), products: z.array(productSchema) })
  .strict();

export const productResponseSchema = z.object({ product: productSchema }).strict();

export type FeaturedResponse = z.infer<typeof featuredResponseSchema>;
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;
export type CategoryPageResponse = z.infer<typeof categoryPageResponseSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ProductResponse = z.infer<typeof productResponseSchema>;
