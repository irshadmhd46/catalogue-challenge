import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnquiryForm } from '../src/features/enquiry/EnquiryForm';
import { errorBody, json, stubApi } from './support/api-stub';
import { renderWithProviders } from './support/render';

afterEach(() => {
  vi.unstubAllGlobals();
});

const POST = 'POST /api/v1/enquiries';
const ACCEPTED = () =>
  json({ enquiryId: '00000000-0000-4000-8000-000000000001', status: 'accepted' }, 202);

const VALID = {
  name: 'Ann Lee',
  email: 'ann@example.test',
  message: 'Is this ring available in size 7?',
};

type User = ReturnType<typeof renderWithProviders>['user'];

async function fill(
  user: User,
  values: Partial<Record<'name' | 'email' | 'phone' | 'message', string>>,
) {
  if (values.name !== undefined) await user.type(screen.getByLabelText('Name'), values.name);
  if (values.email !== undefined) await user.type(screen.getByLabelText('Email'), values.email);
  if (values.phone !== undefined)
    await user.type(screen.getByLabelText('Phone (optional)'), values.phone);
  if (values.message !== undefined)
    await user.type(screen.getByLabelText('Message'), values.message);
}

const submit = (user: User) =>
  user.click(screen.getByRole('button', { name: /Send enquiry|Try again/ }));
const bodyOf = (api: ReturnType<typeof stubApi>) => {
  const body = api.calls.find((c) => c.key === POST)?.init?.body;
  return JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>;
};

describe('enquiry form: validation before sending', () => {
  it('names each invalid field, sends nothing, and keeps what was typed', async () => {
    const api = stubApi({ [POST]: ACCEPTED });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, { name: 'Ann Lee', email: 'not-an-email', message: 'short' });

    await submit(user);

    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      /Email must be a valid email address/,
    );
    expect(screen.getByLabelText('Message')).toHaveAccessibleDescription(
      /Message must be at least 10 characters/,
    );
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveValue('Ann Lee');
    expect(screen.getByLabelText('Email')).toHaveValue('not-an-email');
    expect(api.count(POST)).toBe(0);
  });

  it('asks for the required fields when the form is empty', async () => {
    const api = stubApi({ [POST]: ACCEPTED });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);

    await submit(user);

    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.getByLabelText('Phone (optional)')).not.toHaveAttribute('aria-invalid', 'true');
    expect(api.count(POST)).toBe(0);
  });

  it('clears a field error as soon as that field is edited', async () => {
    stubApi({ [POST]: ACCEPTED });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await submit(user);
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText('Name'), 'A');

    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects an invalid optional phone', async () => {
    const api = stubApi({ [POST]: ACCEPTED });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, { ...VALID, phone: 'call me' });

    await submit(user);

    expect(screen.getByLabelText('Phone (optional)')).toHaveAccessibleDescription(/Phone must be/);
    expect(api.count(POST)).toBe(0);
  });
});

describe('enquiry form: sending', () => {
  it('sends the product id and the trimmed values, and thanks the visitor only after the server accepts', async () => {
    const api = stubApi({ [POST]: ACCEPTED });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, { ...VALID, name: '  Ann Lee  ' });

    await submit(user);

    expect(await screen.findByText(/Thank you/)).toBeInTheDocument();
    expect(bodyOf(api)).toEqual({ productId: 7, ...VALID, name: 'Ann Lee' });
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('includes the phone only when one was typed', async () => {
    const api = stubApi({ [POST]: ACCEPTED });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, { ...VALID, phone: '+44 20 7946 0958' });

    await submit(user);

    await screen.findByText(/Thank you/);
    expect(bodyOf(api)).toMatchObject({ phone: '+44 20 7946 0958' });
  });

  it('does not say thank you while the request is in flight, and cannot be submitted twice', async () => {
    let release: (response: Response) => void = () => undefined;
    const api = stubApi({
      [POST]: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, VALID);

    await submit(user);

    const sending = screen.getByRole('button', { name: 'Sending…' });
    expect(sending).toBeDisabled();
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
    await user.click(sending);
    fireEvent.submit(screen.getByRole('form', { name: 'Enquiry' }));
    expect(api.count(POST)).toBe(1);

    release(ACCEPTED());
    expect(await screen.findByText(/Thank you/)).toBeInTheDocument();
  });
});

describe("enquiry form: failures keep the visitor's input", () => {
  it('maps server field details onto the fields', async () => {
    stubApi({
      [POST]: () =>
        json(
          errorBody('VALIDATION_ERROR', 'Invalid request', 'req-9', [
            { field: 'email', message: 'must be a valid email address' },
            { field: 'unknown', message: 'ignored' },
          ]),
          400,
        ),
    });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, VALID);

    await submit(user);

    expect(await screen.findByText('Email must be a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Message')).toHaveValue(VALID.message);
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
  });

  it('shows the wait time on a 429 and lets the visitor try again with the same input', async () => {
    let calls = 0;
    const api = stubApi({
      [POST]: () => {
        calls += 1;
        return calls === 1
          ? json(errorBody('RATE_LIMITED', 'Too many requests', 'req-429'), 429, {
              'retry-after': '42',
            })
          : ACCEPTED();
      },
    });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, VALID);

    await submit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many requests. Please try again in 42 seconds.');
    expect(alert).toHaveTextContent('Reference: req-429');
    expect(screen.getByLabelText('Email')).toHaveValue(VALID.email);

    await submit(user);

    expect(await screen.findByText(/Thank you/)).toBeInTheDocument();
    expect(api.count(POST)).toBe(2);
    expect(bodyOf(api)).toMatchObject(VALID);
  });

  it.each([
    [
      502,
      'NOTIFICATION_FAILED',
      "We couldn't send your enquiry. Something went wrong on our side.",
    ],
    [404, 'NOT_FOUND', 'That product could not be found.'],
  ])('shows a banner with the reference on a %i', async (status, code, text) => {
    stubApi({ [POST]: () => json(errorBody(code, 'x', 'req-77'), status) });
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, VALID);

    await submit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveTextContent('Reference: req-77');
    expect(screen.getByLabelText('Name')).toHaveValue(VALID.name);
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
  });

  it('shows a network failure without a reference and does not retry on its own', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const { user } = renderWithProviders(<EnquiryForm productId={7} />);
    await fill(user, VALID);

    await submit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't reach the server");
    expect(within(alert).queryByText(/Reference/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
