import { describe, expect, it } from 'vitest';
import { API_PREFIX, catalogPaths } from '../src/index.js';

describe('route paths', () => {
  it('uses the versioned api prefix', () => {
    expect(API_PREFIX).toBe('/api/v1');
  });

  it('defines the five catalogue routes', () => {
    expect(catalogPaths).toEqual({
      featured: '/featured',
      categories: '/categories',
      category: '/categories/:slug',
      products: '/products',
      product: '/products/:id',
    });
  });

  it('writes every path relative to the prefix', () => {
    for (const path of Object.values(catalogPaths)) {
      expect(path.startsWith('/')).toBe(true);
      expect(path.startsWith(API_PREFIX)).toBe(false);
    }
  });
});
