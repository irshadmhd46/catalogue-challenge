import { z } from 'zod';

export const categorySchema = z
  .object({
    slug: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
  })
  .strict();

export const productSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(300),
    description: z.string().max(5000),
    price: z.number().nonnegative(),
    category: categorySchema,
    imageUrl: z.url({ protocol: /^https?$/ }).max(2048),
    rating: z
      .object({
        average: z.number().min(0).max(5),
        count: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type Category = z.infer<typeof categorySchema>;
export type Product = z.infer<typeof productSchema>;
