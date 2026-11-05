import { productSchema } from '@catalogue/contracts';
import { z } from 'zod';
import { categoryFromName } from '../../domain/catalog.js';

// The Fake Store shape. It never leaves this folder: everything below maps it to our contract.
const httpUrl = z.string().refine((raw) => {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}, 'must be an http(s) URL');

const upstreamProductShape = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  description: z.string(),
  category: z.string().min(1),
  image: httpUrl,
  rating: z.object({
    rate: z.number(),
    count: z.number().int().nonnegative(),
  }),
});

type UpstreamProduct = z.infer<typeof upstreamProductShape>;

function toContractShape(upstream: UpstreamProduct): unknown {
  return {
    id: upstream.id,
    title: upstream.title,
    description: upstream.description,
    price: upstream.price,
    category: categoryFromName(upstream.category),
    imageUrl: upstream.image,
    rating: { average: upstream.rating.rate, count: upstream.rating.count },
  };
}

/** Validates the upstream shape, maps it, then validates the result against our own contract. */
export const upstreamProductSchema = upstreamProductShape
  .transform(toContractShape)
  .pipe(productSchema);

export const upstreamProductListSchema = z.array(upstreamProductSchema);
