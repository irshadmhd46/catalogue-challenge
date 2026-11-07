import { useParams } from 'react-router-dom';
import { useCategoryPage } from '../../api/hooks';
import { ProductGrid } from '../../components/ProductTile';
import { QueryState } from '../../components/QueryState';
import { NotFound } from '../NotFound';

export function CategoryPage() {
  const { slug = '' } = useParams();
  const page = useCategoryPage(slug);
  return (
    <QueryState query={page} notFound={<NotFound what="category" />}>
      {(data) => (
        <>
          <h1>{data.category.name}</h1>
          <section aria-labelledby="top-rated">
            <h2 id="top-rated">Top rated</h2>
            <ProductGrid products={data.topRated} />
          </section>
          {data.more.length > 0 && (
            <section aria-labelledby="more">
              <h2 id="more">More in {data.category.name}</h2>
              <ProductGrid products={data.more} />
            </section>
          )}
        </>
      )}
    </QueryState>
  );
}
