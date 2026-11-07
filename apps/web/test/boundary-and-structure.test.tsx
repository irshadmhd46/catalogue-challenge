import { render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

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
