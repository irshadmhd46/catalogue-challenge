import { Link, Outlet } from 'react-router-dom';
import { useCategories } from '../api/hooks';
import { SearchBox } from './SearchBox';

export function Layout() {
  const categories = useCategories();
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
        <Outlet />
      </main>
    </>
  );
}
