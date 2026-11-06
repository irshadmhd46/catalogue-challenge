export const API_PREFIX = '/api/v1';

/** Route templates relative to `API_PREFIX`; `:slug` and `:id` are the path parameters. */
export const enquiryPaths = {
  create: '/enquiries',
} as const;

export const catalogPaths = {
  featured: '/featured',
  categories: '/categories',
  category: '/categories/:slug',
  products: '/products',
  product: '/products/:id',
} as const;
