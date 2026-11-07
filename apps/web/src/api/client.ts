import {
  API_PREFIX,
  catalogPaths,
  categoriesResponseSchema,
  categoryPageResponseSchema,
  enquiryPaths,
  enquiryResponseSchema,
  errorEnvelopeSchema,
  featuredResponseSchema,
  productResponseSchema,
  searchResponseSchema,
  type CategoriesResponse,
  type CategoryPageResponse,
  type EnquiryRequest,
  type EnquiryResponse,
  type FeaturedResponse,
  type ProductResponse,
  type SearchResponse,
} from '@catalogue/contracts';
import { ApiError, NetworkError } from './errors';

export const REQUEST_TIMEOUT_MS = 10_000;

interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
}

function retryAfterSeconds(header: string | null): number | undefined {
  return header !== null && /^[0-9]{1,6}$/.test(header.trim()) ? Number(header.trim()) : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The only function in the web app that calls `fetch`. Every failure leaves it as an `ApiError`
 * (the server answered) or a `NetworkError` (it did not), so components never see a raw fetch error.
 */
async function request<T>(
  path: string,
  schema: Schema<T>,
  options: RequestOptions = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: options.method ?? 'GET',
      headers: hasBody
        ? { accept: 'application/json', 'content-type': 'application/json' }
        : { accept: 'application/json' },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    text = await response.text();
  } catch (cause) {
    throw new NetworkError({ cause });
  }

  const headerRequestId = response.headers.get('x-request-id') ?? undefined;
  const json = parseJson(text);

  if (response.ok) {
    const parsed = schema.safeParse(json);
    if (parsed.success) {
      return parsed.data;
    }
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server sent an unexpected response',
      headerRequestId,
    );
  }

  const envelope = errorEnvelopeSchema.safeParse(json);
  if (envelope.success) {
    const { code, message, requestId, details } = envelope.data.error;
    throw new ApiError(
      response.status,
      code,
      message,
      requestId,
      details,
      retryAfterSeconds(response.headers.get('retry-after')),
    );
  }
  throw new ApiError(
    response.status,
    'INVALID_RESPONSE',
    'The server sent an unexpected response',
    headerRequestId,
  );
}

export function getFeatured(): Promise<FeaturedResponse> {
  return request(catalogPaths.featured, featuredResponseSchema);
}

export function getCategories(): Promise<CategoriesResponse> {
  return request(catalogPaths.categories, categoriesResponseSchema);
}

export function getCategoryPage(slug: string): Promise<CategoryPageResponse> {
  return request(
    catalogPaths.category.replace(':slug', encodeURIComponent(slug)),
    categoryPageResponseSchema,
  );
}

export function searchProducts(query: string): Promise<SearchResponse> {
  return request(`${catalogPaths.products}?q=${encodeURIComponent(query)}`, searchResponseSchema);
}

export function getProduct(id: string): Promise<ProductResponse> {
  return request(
    catalogPaths.product.replace(':id', encodeURIComponent(id)),
    productResponseSchema,
  );
}

export function sendEnquiry(enquiry: EnquiryRequest): Promise<EnquiryResponse> {
  return request(enquiryPaths.create, enquiryResponseSchema, { method: 'POST', body: enquiry });
}
