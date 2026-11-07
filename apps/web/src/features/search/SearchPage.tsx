import { useSearchParams } from 'react-router-dom';
import { useSearch } from '../../api/hooks';
import { ProductGrid } from '../../components/ProductTile';
import { QueryState } from '../../components/QueryState';

export function SearchPage() {
  const [params] = useSearchParams();
  const term = (params.get('q') ?? '').trim();
  const results = useSearch(term);

  if (term === '') {
    return (
      <section>
        <h1>Search</h1>
        <p>Type something in the search box to find products.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>Results for &ldquo;{term}&rdquo;</h1>
      <QueryState
        query={results}
        isEmpty={(data) => data.products.length === 0}
        emptyMessage="No products match your search."
      >
        {(data) => <ProductGrid products={data.products} />}
      </QueryState>
    </section>
  );
}
