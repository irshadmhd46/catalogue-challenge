export interface Enquiry {
  readonly id: string;
  readonly receivedAt: Date;
  /** Taken from the catalogue, never from the request. */
  readonly product: { readonly id: number; readonly title: string };
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly message: string;
}
