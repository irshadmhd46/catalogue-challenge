import {
  API_PREFIX,
  catalogPaths,
  categorySlugParamsSchema,
  productIdParamsSchema,
  searchQuerySchema,
  type CategoriesResponse,
  type CategoryPageResponse,
  type FeaturedResponse,
  type ProductResponse,
  type SearchResponse,
} from '@catalogue/contracts';
import type { FastifyInstance } from 'fastify';
import type { CatalogService } from '../application/catalog-service.js';
import { parseRequest } from './validation.js';

const at = (path: string) => `${API_PREFIX}${path}`;
const READ = { config: { rateScope: 'read' } } as const;

export function registerCatalogueRoutes(app: FastifyInstance, catalog: CatalogService): void {
  app.get(at(catalogPaths.featured), READ, async (): Promise<FeaturedResponse> => {
    return { products: await catalog.featured() };
  });

  app.get(at(catalogPaths.categories), READ, async (): Promise<CategoriesResponse> => {
    return { categories: await catalog.categories() };
  });

  app.get(at(catalogPaths.category), READ, async (request): Promise<CategoryPageResponse> => {
    const { slug } = parseRequest(categorySlugParamsSchema, request.params);
    return catalog.categoryPage(slug);
  });

  app.get(at(catalogPaths.products), READ, async (request): Promise<SearchResponse> => {
    const { q } = parseRequest(searchQuerySchema, request.query);
    return { query: q, products: await catalog.search(q) };
  });

  app.get(at(catalogPaths.product), READ, async (request): Promise<ProductResponse> => {
    const { id } = parseRequest(productIdParamsSchema, request.params);
    return { product: await catalog.find(id) };
  });
}
