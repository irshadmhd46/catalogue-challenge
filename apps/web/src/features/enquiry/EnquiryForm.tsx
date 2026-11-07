import { enquiryRequestSchema, type EnquiryRequest } from '@catalogue/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { sendEnquiry } from '../../api/client';
import { ApiError, type FieldDetail } from '../../api/errors';
import { describeError, referenceOf } from '../../components/ErrorMessage';

type FieldName = 'name' | 'email' | 'phone' | 'message';
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELDS: readonly { name: FieldName; label: string; multiline?: true; type?: string }[] = [
  { name: 'name', label: 'Name' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Phone (optional)', type: 'tel' },
  { name: 'message', label: 'Message', multiline: true },
];

const isField = (value: string): value is FieldName => FIELDS.some((field) => field.name === value);

function fieldErrorsFrom(details: readonly FieldDetail[] | undefined): FieldErrors {
  const errors: FieldErrors = {};
  for (const { field, message } of details ?? []) {
    if (isField(field) && errors[field] === undefined) {
      errors[field] = message;
    }
  }
  return errors;
}

/** Validates with the same schema the server uses, so the messages agree. */
function validate(payload: unknown): { data: EnquiryRequest } | { errors: FieldErrors } {
  const result = enquiryRequestSchema.safeParse(payload);
  if (result.success) {
    return { data: result.data };
  }
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    if (isField(field) && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return { errors };
}

function bannerFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return error.retryAfterSeconds === undefined
      ? 'Too many requests. Please try again in a minute.'
      : `Too many requests. Please try again in ${String(error.retryAfterSeconds)} seconds.`;
  }
  if (error instanceof ApiError && error.status === 404) {
    return 'That product could not be found.';
  }
  return `We couldn't send your enquiry. ${describeError(error)}`;
}

export function EnquiryForm({ productId }: { readonly productId: number }) {
  const [values, setValues] = useState({ name: '', email: '', phone: '', message: '' });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const mutation = useMutation({ mutationFn: sendEnquiry });

  if (mutation.isSuccess) {
    return (
      <p
        role="status"
        tabIndex={-1}
        ref={(element) => element?.focus()}
        className="notice notice--success"
      >
        Thank you! Your enquiry has been sent and our sales team will be in touch.
      </p>
    );
  }

  const failure: unknown = mutation.error;
  const serverErrors =
    failure instanceof ApiError && failure.status === 400 ? fieldErrorsFrom(failure.details) : {};
  const errors: FieldErrors = { ...serverErrors, ...clientErrors };
  const showBanner = failure !== null && Object.keys(serverErrors).length === 0;

  function submit(event?: FormEvent<HTMLFormElement>): void {
    event?.preventDefault();
    if (mutation.isPending) {
      return;
    }
    const payload = {
      productId,
      name: values.name,
      email: values.email,
      ...(values.phone.trim() === '' ? {} : { phone: values.phone }),
      message: values.message,
    };
    const checked = validate(payload);
    if ('errors' in checked) {
      setClientErrors(checked.errors);
      const first = FIELDS.find((field) => checked.errors[field.name] !== undefined);
      if (first !== undefined) {
        document.getElementById(`enquiry-${first.name}`)?.focus();
      }
      return;
    }
    setClientErrors({});
    mutation.mutate(checked.data);
  }

  return (
    <form className="enquiry" onSubmit={submit} noValidate aria-label="Enquiry">
      <h2>Enquire about this product</h2>
      {FIELDS.map(({ name, label, multiline, type }) => {
        const error = errors[name];
        const common = {
          id: `enquiry-${name}`,
          name,
          value: values[name],
          'aria-invalid': error !== undefined,
          'aria-describedby': error === undefined ? undefined : `enquiry-${name}-error`,
        };
        const onChange = (value: string): void => {
          setValues((current) => ({ ...current, [name]: value }));
          setClientErrors((current) => ({ ...current, [name]: undefined }));
        };
        return (
          <div className="field" key={name}>
            <label htmlFor={`enquiry-${name}`}>{label}</label>
            {multiline === true ? (
              <textarea
                {...common}
                rows={5}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
              />
            ) : (
              <input
                {...common}
                type={type ?? 'text'}
                onChange={(event) => {
                  onChange(event.target.value);
                }}
              />
            )}
            {error !== undefined && (
              <span id={`enquiry-${name}-error`} className="field-error" role="alert">
                {label.replace(' (optional)', '')} {error}
              </span>
            )}
          </div>
        );
      })}

      {showBanner && (
        <div className="notice notice--error" role="alert">
          <p>{bannerFor(failure)}</p>
          {referenceOf(failure) !== undefined && (
            <p className="notice__reference">Reference: {referenceOf(failure)}</p>
          )}
        </div>
      )}

      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Sending…' : showBanner ? 'Try again' : 'Send enquiry'}
      </button>
    </form>
  );
}
