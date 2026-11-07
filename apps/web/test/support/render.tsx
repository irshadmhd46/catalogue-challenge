import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../src/App';

/** No automatic retries and no cache sharing between tests; the retry policy has its own tests. */
export function testQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

export function renderWithProviders(ui: ReactElement, route = '/') {
  const user = userEvent.setup();
  const result = render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, ...result };
}

export const renderApp = (route = '/') => renderWithProviders(<AppRoutes />, route);
