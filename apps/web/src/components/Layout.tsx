import { Link, Outlet, useLocation } from 'react-router-dom';
import { useCategories } from '../api/hooks';
import { ErrorBoundary } from './ErrorBoundary';
import { SearchBox } from './SearchBox';

export function Layout() {
  const categories = useCategories();
  const { pathname } = useLocation();
  return (
    <>
      <header className="site-header">
        <Link to="/" className="site-title">
          Catalogue
        </Link>
        <SearchBox />
        <nav aria-label="Categories">
          {/* A failure here must not take the page down: the links are simply absent. */}
          {categories.data?.categories.map((category) => (
            <Link key={category.slug} to={`/categories/${category.slug}`}>
              {category.name}
            </Link>
          ))}
        </nav>
      </header>
      <main>
        {/* Keyed on the path so leaving a broken page clears the failure; the header stays usable. */}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}
