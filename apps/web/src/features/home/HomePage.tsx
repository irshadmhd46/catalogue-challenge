import { useFeatured } from '../../api/hooks';
import { ProductGrid } from '../../components/ProductTile';
import { QueryState } from '../../components/QueryState';

export function HomePage() {
  const featured = useFeatured();
  return (
    <section>
      <h1>Featured products</h1>
      <QueryState
        query={featured}
        isEmpty={(data) => data.products.length === 0}
        emptyMessage="No featured products yet."
      >
        {(data) => <ProductGrid products={data.products} />}
      </QueryState>
    </section>
  );
}
