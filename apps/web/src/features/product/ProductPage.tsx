import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useProduct } from '../../api/hooks';
import { QueryState } from '../../components/QueryState';
import { formatPrice } from '../../format';
import { EnquiryForm } from '../enquiry/EnquiryForm';
import { NotFound } from '../NotFound';

export function ProductPage() {
  const { id = '' } = useParams();
  const product = useProduct(id);
  const [enquiring, setEnquiring] = useState(false);

  return (
    <QueryState query={product} notFound={<NotFound what="product" />}>
      {({ product: item }) => (
        <article className="product">
          <img className="product__image" src={item.imageUrl} alt="" />
          <div className="product__body">
            <h1>{item.title}</h1>
            <p className="product__price">{formatPrice(item.price)}</p>
            <p>
              Rated {item.rating.average.toFixed(1)} out of 5 ({item.rating.count} ratings)
            </p>
            <p>
              Category: <Link to={`/categories/${item.category.slug}`}>{item.category.name}</Link>
            </p>
            <p>{item.description}</p>
            {enquiring ? (
              <EnquiryForm key={item.id} productId={item.id} />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEnquiring(true);
                }}
              >
                Enquire
              </button>
            )}
          </div>
        </article>
      )}
    </QueryState>
  );
}
