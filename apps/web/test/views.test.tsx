import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorBody, json, product, stubApi, type Handler } from './support/api-stub';
import { renderApp } from './support/render';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CATEGORIES: Record<string, Handler> = {
  'GET /api/v1/categories': () =>
    json({
      categories: [
        { slug: 'electronics', name: 'Electronics' },
        { slug: 'jewelery', name: 'Jewelery' },
      ],
    }),
};

const main = () => screen.getByRole('main');

describe('home page', () => {
  it('shows the five featured products as links to their pages', async () => {
    const featured = [1, 2, 3, 4, 5].map((id) => product(id));
    stubApi({ ...CATEGORIES, 'GET /api/v1/featured': () => json({ products: featured }) });

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Featured products' })).toBeInTheDocument();
    const links = await within(main()).findAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/products/1',
      '/products/2',
      '/products/3',
      '/products/4',
      '/products/5',
    ]);
    expect(within(links[0] as HTMLElement).getByText('Product 1')).toBeInTheDocument();
    expect(within(links[0] as HTMLElement).getByText('$11.00')).toBeInTheDocument();
  });

  it('shows a loading state while the request is in flight', async () => {
    stubApi({
      ...CATEGORIES,
      'GET /api/v1/featured': () => new Promise<Response>(() => undefined),
    });

    renderApp('/');

    expect(await screen.findByRole('status')).toHaveTextContent('Loading');
  });

  it('shows the server failure with its reference, and Try again fetches once more', async () => {
    let attempts = 0;
    const api = stubApi({
      ...CATEGORIES,
      'GET /api/v1/featured': () => {
        attempts += 1;
        return attempts === 1
          ? json(errorBody('UPSTREAM_ERROR', 'Upstream failed', 'req-abc'), 502)
          : json({ products: [product(1)] });
      },
    });
    const { user } = renderApp('/');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on our side');
    expect(alert).toHaveTextContent('Reference: req-abc');
    expect(alert).not.toHaveTextContent('Upstream failed');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await within(main()).findByText('Product 1')).toBeInTheDocument();
    expect(api.count('GET /api/v1/featured')).toBe(2);
  });

  it('says so when there is nothing featured', async () => {
    stubApi({ ...CATEGORIES, 'GET /api/v1/featured': () => json({ products: [] }) });

    renderApp('/');

    expect(await screen.findByText('No featured products yet.')).toBeInTheDocument();
  });

  it('lists the categories in the navigation, and the page still works if they fail to load', async () => {
    stubApi({
      'GET /api/v1/categories': () => json(errorBody('UPSTREAM_ERROR', 'x'), 502),
      'GET /api/v1/featured': () => json({ products: [product(1)] }),
    });

    renderApp('/');

    expect(await within(main()).findByText('Product 1')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Categories' })).queryAllByRole('link'),
    ).toHaveLength(0);
  });

  it('links each category in the navigation to its page', async () => {
    stubApi({ ...CATEGORIES, 'GET /api/v1/featured': () => json({ products: [] }) });

    renderApp('/');

    const nav = screen.getByRole('navigation', { name: 'Categories' });
    const link = await within(nav).findByRole('link', { name: 'Jewelery' });
    expect(link).toHaveAttribute('href', '/categories/jewelery');
    expect(within(nav).getByRole('link', { name: 'Electronics' })).toHaveAttribute(
      'href',
      '/categories/electronics',
    );
  });
});

describe('category page', () => {
  const page = (more = [product(4), product(5)]) =>
    json({
      category: { slug: 'electronics', name: 'Electronics' },
      topRated: [product(1), product(2), product(3)],
      more,
    });

  it('shows the three top rated first, then the rest, in separate sections', async () => {
    stubApi({ ...CATEGORIES, 'GET /api/v1/categories/electronics': () => page() });

    renderApp('/categories/electronics');

    expect(
      await screen.findByRole('heading', { name: 'Electronics', level: 1 }),
    ).toBeInTheDocument();
    const top = screen.getByRole('region', { name: 'Top rated' });
    const more = screen.getByRole('region', { name: 'More in Electronics' });
    expect(within(top).getAllByRole('listitem')).toHaveLength(3);
    expect(within(top).getByText('Product 1')).toBeInTheDocument();
    expect(within(more).getAllByRole('listitem')).toHaveLength(2);
    expect(within(more).getByText('Product 4')).toBeInTheDocument();
  });

  it('omits the second section when the category has no more products', async () => {
    stubApi({ ...CATEGORIES, 'GET /api/v1/categories/electronics': () => page([]) });

    renderApp('/categories/electronics');

    await screen.findByRole('region', { name: 'Top rated' });
    expect(screen.queryByRole('region', { name: /More in/ })).not.toBeInTheDocument();
  });

  it('shows a friendly not-found page for an unknown category, not an error banner', async () => {
    stubApi({
      ...CATEGORIES,
      'GET /api/v1/categories/nope': () => json(errorBody('NOT_FOUND', 'Category not found'), 404),
    });

    renderApp('/categories/nope');

    expect(
      await screen.findByRole('heading', { name: "We couldn't find that category" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('search', () => {
  it('searches from the header box and lists the matches', async () => {
    const api = stubApi({
      ...CATEGORIES,
      'GET /api/v1/featured': () => json({ products: [] }),
      'GET /api/v1/products?q=gold%20%26%20silver': () =>
        json({ query: 'gold & silver', products: [product(6, { title: 'Gold ring' })] }),
    });
    const { user } = renderApp('/');

    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), '  gold & silver ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('heading', { name: /Results for/ })).toHaveTextContent(
      'Results for “gold & silver”',
    );
    expect(await within(main()).findByText('Gold ring')).toBeInTheDocument();
    expect(api.count('GET /api/v1/products?q=gold%20%26%20silver')).toBe(1);
  });

  it('says so when nothing matches', async () => {
    stubApi({
      ...CATEGORIES,
      'GET /api/v1/products?q=zzz': () => json({ query: 'zzz', products: [] }),
    });

    renderApp('/search?q=zzz');

    expect(await screen.findByText('No products match your search.')).toBeInTheDocument();
  });

  it('refuses a blank search without calling the API', async () => {
    const api = stubApi({ ...CATEGORIES, 'GET /api/v1/featured': () => json({ products: [] }) });
    const { user } = renderApp('/');
    await screen.findByText('No featured products yet.');

    await user.type(screen.getByRole('searchbox'), '   ');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter something to search for.');
    expect(api.calls.map((c) => c.key).filter((key) => key.includes('products?q'))).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Featured products' })).toBeInTheDocument();
  });

  it('asks for a term on /search without one, and makes no search request', async () => {
    const api = stubApi({ ...CATEGORIES });

    renderApp('/search');

    expect(await screen.findByText(/Type something in the search box/)).toBeInTheDocument();
    expect(api.calls.map((c) => c.key)).toEqual(['GET /api/v1/categories']);
  });
});

describe('product page', () => {
  const found = (overrides = {}) => json({ product: product(7, overrides) });

  it('shows the details and links to the category', async () => {
    stubApi({ ...CATEGORIES, 'GET /api/v1/products/7': () => found() });

    renderApp('/products/7');

    expect(await screen.findByRole('heading', { name: 'Product 7', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('$17.00')).toBeInTheDocument();
    expect(screen.getByText('Description of product 7')).toBeInTheDocument();
    expect(screen.getByText(/Rated 4\.2 out of 5 \(107 ratings\)/)).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Electronics' })).toHaveAttribute(
      'href',
      '/categories/electronics',
    );
  });

  it('renders hostile product text as text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.pwned=1"><script>window.pwned=1</script>';
    stubApi({
      ...CATEGORIES,
      'GET /api/v1/products/7': () => found({ title: hostile, description: hostile }),
    });

    renderApp('/products/7');

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(hostile);
    expect(main().querySelector('script')).toBeNull();
    expect(main().querySelector('img[src="x"]')).toBeNull();
  });

  it('keeps the enquiry form hidden until the visitor asks for it', async () => {
    stubApi({ ...CATEGORIES, 'GET /api/v1/products/7': () => found() });
    const { user } = renderApp('/products/7');
    await screen.findByRole('heading', { name: 'Product 7' });
    expect(screen.queryByRole('form', { name: 'Enquiry' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enquire' }));

    expect(screen.getByRole('form', { name: 'Enquiry' })).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown product', async () => {
    stubApi({
      ...CATEGORIES,
      'GET /api/v1/products/9999': () => json(errorBody('NOT_FOUND', 'Product not found'), 404),
    });

    renderApp('/products/9999');

    expect(
      await screen.findByRole('heading', { name: "We couldn't find that product" }),
    ).toBeInTheDocument();
  });

  it('shows a network failure with a retry and no reference', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      input.endsWith('/categories')
        ? Promise.resolve(json({ categories: [] }))
        : Promise.reject(new TypeError('Failed to fetch')),
    );

    renderApp('/products/7');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't reach the server");
    expect(alert).not.toHaveTextContent('Reference');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('unknown routes', () => {
  it('show the not-found page with a way home', async () => {
    stubApi({ ...CATEGORIES });

    renderApp('/no/such/page');

    expect(
      await screen.findByRole('heading', { name: "We couldn't find that page" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute(
        'href',
        '/',
      );
    });
  });
});
