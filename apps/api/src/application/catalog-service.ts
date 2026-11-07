import {
  CATEGORY_TOP_COUNT,
  FEATURED_COUNT,
  rankProducts,
  type Category,
  type Product,
} from '../domain/catalog.js';
import { NotFoundError } from '../domain/errors.js';
import type { Logger } from '../domain/logger.js';
import type { ProductSource } from '../domain/product-source.js';

export interface CategoryPage {
  readonly category: Category;
  readonly topRated: Product[];
  readonly more: Product[];
}

export class CatalogService {
  constructor(
    private readonly source: ProductSource,
    private readonly logger: Logger,
    private readonly featuredProductIds: readonly number[] = [],
  ) {}

  async featured(): Promise<Product[]> {
    const products = await this.source.listProducts();
    const curated = this.curated(products);
    return curated ?? rankProducts(products).slice(0, FEATURED_COUNT);
  }

  async categories(): Promise<Category[]> {
    const products = await this.source.listProducts();
    return this.categoriesOf(products);
  }

  async categoryPage(slug: string): Promise<CategoryPage> {
    const products = await this.source.listProducts();
    const category = this.categoriesOf(products).find((candidate) => candidate.slug === slug);
    if (category === undefined) {
      throw new NotFoundError('category', slug);
    }

    const ranked = rankProducts(products.filter((product) => product.category.slug === slug));
    return {
      category,
      topRated: ranked.slice(0, CATEGORY_TOP_COUNT),
      more: ranked.slice(CATEGORY_TOP_COUNT),
    };
  }

  async search(query: string): Promise<Product[]> {
    const needle = query.trim().toLowerCase();
    const products = await this.source.listProducts();
    const matches = products.filter((product) =>
      [product.title, product.description, product.category.name].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
    return rankProducts(matches);
  }

  async find(id: number): Promise<Product> {
    const product = await this.source.findProduct(id);
    if (product === undefined) {
      throw new NotFoundError('product', String(id));
    }
    return product;
  }

  /** The configured featured list, or `undefined` when no override applies. */
  private curated(products: readonly Product[]): Product[] | undefined {
    if (this.featuredProductIds.length === 0) {
      return undefined;
    }

    const byId = new Map(products.map((product) => [product.id, product] as const));
    const found: Product[] = [];
    const missingIds: number[] = [];
    for (const id of this.featuredProductIds) {
      const product = byId.get(id);
      if (product === undefined) {
        missingIds.push(id);
      } else {
        found.push(product);
      }
    }

    if (missingIds.length > 0) {
      this.logger.warn(
        { missingIds, usingFallback: found.length === 0 },
        'featured override references unknown products',
      );
    }
    return found.length === 0 ? undefined : found;
  }

  private categoriesOf(products: readonly Product[]): Category[] {
    const bySlug = new Map<string, Category>();
    for (const { category } of products) {
      const existing = bySlug.get(category.slug);
      if (existing === undefined) {
        bySlug.set(category.slug, { ...category });
      } else if (existing.name !== category.name) {
        this.logger.warn(
          { slug: category.slug, kept: existing.name, ignored: category.name },
          'category names collide on one slug',
        );
      }
    }
    return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
