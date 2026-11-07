/** The upstream gives no currency, so a dollar sign is an assumption recorded in DECISIONS.md. */
export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}
