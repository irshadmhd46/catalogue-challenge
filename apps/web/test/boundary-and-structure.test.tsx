import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { Layout } from '../src/components/Layout';
import { json, stubApi } from './support/api-stub';
import { testQueryClient } from './support/render';

function Broken(): never {
  throw new Error('render failed');
}

describe('error boundary', () => {
  it('shows a message instead of a blank page when rendering throws', () => {
    // React logs the caught error; keep the test output readable.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
      expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    } finally {
      log.mockRestore();
    }
  });

  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('all good')).toBeInTheDocument();
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('architecture rules', () => {
  const files = sourceFiles(join(__dirname, '../src'));

  it('calls fetch only from api/client.ts', () => {
    const callers = files.filter((file) => /\bfetch\(/.test(readFileSync(file, 'utf8')));

    expect(callers.map((file) => file.split('/src/')[1])).toEqual(['api/client.ts']);
  });

  it('never renders raw HTML', () => {
    const offenders = files.filter((file) =>
      /dangerouslySetInnerHTML|innerHTML/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('never mentions the upstream catalogue', () => {
    const offenders = files.filter((file) => /fakestoreapi/i.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });
});

describe('route-level error boundary', () => {
  it('keeps the header usable when a page breaks, and recovers on navigation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      stubApi({ 'GET /api/v1/categories': () => json({ categories: [] }) });
      const router = createMemoryRouter(
        [
          {
            element: <Layout />,
            children: [
              { index: true, element: <Broken /> },
              { path: 'ok', element: <p>fine page</p> },
            ],
          },
        ],
        { initialEntries: ['/'] },
      );
      render(
        <QueryClientProvider client={testQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );

      expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
      expect(screen.getByRole('link', { name: 'Catalogue' })).toBeInTheDocument();
      expect(screen.getByRole('searchbox')).toBeInTheDocument();

      await act(() => router.navigate('/ok'));

      expect(screen.getByText('fine page')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
