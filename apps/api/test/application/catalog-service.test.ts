import { describe, expect, it } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service.js';
import { NotFoundError, UpstreamError } from '../../src/domain/errors.js';
import { productWith } from '../support/catalog-fixture.js';
import { FakeLogger } from '../support/fake-logger.js';
import { FakeProductSource } from '../support/fake-product-source.js';

function setup(options: { featuredIds?: number[]; source?: FakeProductSource } = {}) {
  const source = options.source ?? new FakeProductSource();
  const logger = new FakeLogger();
  const service = new CatalogService(source, logger, options.featuredIds ?? []);
  return { source, logger, service };
}

const ids = (products: readonly { id: number }[]) => products.map((p) => p.id);

// Fixture ratings: 5 = 4.6/400, 6 = 3.9/70, 7 = 3.0/400, 8 = 1.9/100 (the jewelery category).
const JEWELERY_RANKED = [5, 6, 7, 8];

describe('CatalogService.featured', () => {
  it('returns exactly 5 products: 12, 11, 3, 18, 5 in ranking order', async () => {
    const { service, source } = setup();

    const featured = await service.featured();

    expect(ids(featured)).toEqual([12, 11, 3, 18, 5]);
    expect(source.listCalls).toBe(1);
  });

  it('does not mutate or return the source array', async () => {
    const { service, source } = setup();
    const before = ids(source.products);

    const featured = await service.featured();

    expect(ids(source.products)).toEqual(before);
    expect(featured).not.toBe(source.products);
  });

  it('keeps the configured order when an override is set', async () => {
    const { service } = setup({ featuredIds: [7, 2, 15] });

    expect(ids(await service.featured())).toEqual([7, 2, 15]);
  });

  it('skips unknown override ids and warns once, naming them', async () => {
    const { service, logger } = setup({ featuredIds: [7, 9999, 2] });

    expect(ids(await service.featured())).toEqual([7, 2]);

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ missingIds: [9999] });
  });

  it('falls back to the ranking rule and warns when no override id exists', async () => {
    const { service, logger } = setup({ featuredIds: [9998, 9999] });

    expect(ids(await service.featured())).toEqual([12, 11, 3, 18, 5]);

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ missingIds: [9998, 9999] });
  });

  it('writes no warning when every override id exists', async () => {
    const { service, logger } = setup({ featuredIds: [1, 2] });

    await service.featured();

    expect(logger.records).toHaveLength(0);
  });

  it('propagates the same error instance when the source fails', async () => {
    const { service, source } = setup();
    source.failure = new UpstreamError();

    await expect(service.featured()).rejects.toBe(source.failure);
  });
});

describe('CatalogService.categories', () => {
  it('returns the four fixture categories sorted by name', async () => {
    const { service } = setup();

    const categories = await service.categories();

    expect(categories.map((c) => c.slug)).toEqual([
      'electronics',
      'jewelery',
      'mens-clothing',
      'womens-clothing',
    ]);
    expect(categories[2]).toEqual({ slug: 'mens-clothing', name: "Men's Clothing" });
  });

  it('keeps the first category and warns once when two names share a slug', async () => {
    const source = new FakeProductSource([
      productWith({ id: 1, category: { slug: 'kids', name: 'Kids' } }),
      productWith({ id: 2, category: { slug: 'kids', name: 'KIDS' } }),
      productWith({ id: 3, category: { slug: 'kids', name: 'Kids' } }),
    ]);
    const { service, logger } = setup({ source });

    expect(await service.categories()).toEqual([{ slug: 'kids', name: 'Kids' }]);

    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0]?.fields).toMatchObject({ slug: 'kids' });
  });

  it('returns an empty list for an empty catalogue', async () => {
    const { service } = setup({ source: new FakeProductSource([]) });

    expect(await service.categories()).toEqual([]);
  });

  it('propagates source failures', async () => {
    const { service, source } = setup();
    source.failure = new UpstreamError();

    await expect(service.categories()).rejects.toBe(source.failure);
  });
});

describe('CatalogService.categoryPage', () => {
  it('splits electronics into 3 top rated and 3 more, ranked, with no overlap', async () => {
    const { service } = setup();

    const page = await service.categoryPage('electronics');

    expect(page.category).toEqual({ slug: 'electronics', name: 'Electronics' });
    expect(ids(page.topRated)).toEqual([12, 11, 9]);
    expect(page.more).toHaveLength(3);
    const all = [...ids(page.topRated), ...ids(page.more)];
    expect(new Set(all).size).toBe(6);
    const lowestTop = Math.min(...page.topRated.map((p) => p.rating.average));
    const highestRest = Math.max(...page.more.map((p) => p.rating.average));
    expect(lowestTop).toBeGreaterThanOrEqual(highestRest);
  });

  it('only contains products of the requested category', async () => {
    const { service } = setup();

    const page = await service.categoryPage('jewelery');

    const all = [...page.topRated, ...page.more];
    expect(all.every((p) => p.category.slug === 'jewelery')).toBe(true);
    expect(ids(page.topRated)).toEqual(JEWELERY_RANKED.slice(0, 3));
    expect(ids(page.more)).toEqual(JEWELERY_RANKED.slice(3));
  });

  it('puts everything in topRated and leaves more empty for a small category', async () => {
    const source = new FakeProductSource([
      productWith({ id: 1, category: { slug: 'tiny', name: 'Tiny' } }),
      productWith({ id: 2, category: { slug: 'tiny', name: 'Tiny' } }),
    ]);
    const { service } = setup({ source });

    const page = await service.categoryPage('tiny');

    expect(page.topRated).toHaveLength(2);
    expect(page.more).toEqual([]);
  });

  it('throws NotFoundError for an unknown slug after one list call and no find call', async () => {
    const { service, source } = setup();

    const failure = await service.categoryPage('nope').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotFoundError);
    expect(failure).toMatchObject({ resource: 'category', resourceId: 'nope' });
    expect(source.listCalls).toBe(1);
    expect(source.findCalls).toEqual([]);
  });

  it('propagates source failures', async () => {
    const { service, source } = setup();
    source.failure = new UpstreamError();

    await expect(service.categoryPage('electronics')).rejects.toBe(source.failure);
  });
});

describe('CatalogService.search', () => {
  it('matches on title', async () => {
    const { service } = setup();

    expect(ids(await service.search('backpack'))).toContain(1);
  });

  it('is case insensitive', async () => {
    const { service } = setup();

    expect(ids(await service.search('BACKPACK'))).toEqual(ids(await service.search('backpack')));
  });

  it('matches on description when the title does not match', async () => {
    const source = new FakeProductSource([
      productWith({ id: 1, title: 'Plain bag', description: 'Fully waterproof fabric' }),
      productWith({ id: 2, title: 'Other', description: 'Nothing relevant' }),
    ]);
    const { service } = setup({ source });

    expect(ids(await service.search('waterproof'))).toEqual([1]);
  });

  it('matches on category name', async () => {
    const { service } = setup();

    expect(ids(await service.search('jewelery'))).toEqual(JEWELERY_RANKED);
  });

  it('trims the query before matching', async () => {
    const { service } = setup();

    expect(ids(await service.search('  backpack '))).toEqual(ids(await service.search('backpack')));
  });

  it('returns matches in ranking order, not upstream order', async () => {
    const source = new FakeProductSource([
      productWith({ id: 1, title: 'lamp', rating: { average: 2, count: 5 } }),
      productWith({ id: 2, title: 'lamp', rating: { average: 5, count: 5 } }),
      productWith({ id: 3, title: 'lamp', rating: { average: 3, count: 5 } }),
    ]);
    const { service } = setup({ source });

    expect(ids(await service.search('lamp'))).toEqual([2, 3, 1]);
  });

  it('resolves to an empty array when nothing matches', async () => {
    const { service } = setup();

    expect(await service.search('zzzzzz')).toEqual([]);
  });

  it('treats regular expression characters literally', async () => {
    const source = new FakeProductSource([
      productWith({ id: 1, title: 'Plain' }),
      productWith({ id: 2, title: 'Widget (blue)' }),
    ]);
    const { service } = setup({ source });

    expect(await service.search('.*')).toEqual([]);
    expect(ids(await service.search('('))).toEqual([2]);
  });

  it('does not mutate the source array', async () => {
    const { service, source } = setup();
    const before = ids(source.products);

    await service.search('a');

    expect(ids(source.products)).toEqual(before);
  });

  it('propagates source failures', async () => {
    const { service, source } = setup();
    source.failure = new UpstreamError();

    await expect(service.search('a')).rejects.toBe(source.failure);
  });
});

describe('CatalogService.find', () => {
  it('returns the product from the source', async () => {
    const { service, source } = setup();

    const product = await service.find(1);

    expect(product.id).toBe(1);
    expect(source.findCalls).toEqual([1]);
    expect(source.listCalls).toBe(0);
  });

  it('throws NotFoundError for a missing product', async () => {
    const { service } = setup();

    const failure = await service.find(9999).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NotFoundError);
    expect(failure).toMatchObject({ resource: 'product', resourceId: '9999' });
  });

  it('propagates source failures', async () => {
    const { service, source } = setup();
    source.failure = new UpstreamError();

    await expect(service.find(1)).rejects.toBe(source.failure);
  });
});
