import type { Category, Product } from '@catalogue/contracts';

export type { Category, Product };

export const FEATURED_COUNT = 5;
export const CATEGORY_TOP_COUNT = 3;

/** Lowercase, drop apostrophes, turn every other run of non-alphanumerics into one hyphen. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function capitaliseWords(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Builds our category identity from whatever name a data source uses. */
export function categoryFromName(rawName: string): Category {
  return { slug: slugify(rawName), name: capitaliseWords(rawName) };
}

/** The one ranking rule: rating, then number of ratings, then id so ties never flip. */
function byRating(a: Product, b: Product): number {
  return b.rating.average - a.rating.average || b.rating.count - a.rating.count || a.id - b.id;
}

export function rankProducts(products: readonly Product[]): Product[] {
  return [...products].sort(byRating);
}
