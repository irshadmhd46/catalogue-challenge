import type { Product } from '@catalogue/contracts';
import { Link } from 'react-router-dom';
import { formatPrice } from '../format';

interface Props {
  readonly product: Product;
}

/** Product text comes from an untrusted source: it is only ever rendered as text. */
export function ProductTile({ product }: Props) {
  return (
    <li className="tile">
      <Link to={`/products/${String(product.id)}`} className="tile__link">
        <img className="tile__image" src={product.imageUrl} alt="" loading="lazy" />
        <span className="tile__title">{product.title}</span>
        <span className="tile__price">{formatPrice(product.price)}</span>
        <span className="tile__rating">
          ★ {product.rating.average.toFixed(1)} ({product.rating.count})
        </span>
      </Link>
    </li>
  );
}

export function ProductGrid({ products }: { readonly products: readonly Product[] }) {
  return (
    <ul className="grid">
      {products.map((product) => (
        <ProductTile key={product.id} product={product} />
      ))}
    </ul>
  );
}
