import { Link } from 'react-router-dom';

export function NotFound({ what = 'page' }: { readonly what?: string }) {
  return (
    <section>
      <h1>We couldn&apos;t find that {what}</h1>
      <p>
        <Link to="/">Back to the home page</Link>
      </p>
    </section>
  );
}
