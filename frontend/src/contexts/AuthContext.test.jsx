import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { AuthContext, AuthProvider } from './AuthContext';
import { fetchResponse } from '../test/fetchResponse';

vi.mock('../utils/analytics', () => ({ track: vi.fn() }));

const SIGNED_IN = { id: 5, email: 'hiker@example.com', favorites: [3], visited: [4] };

const captured = { current: null };
function Probe() {
  const ctx = useContext(AuthContext);
  useEffect(() => { captured.current = ctx; });
  return <span data-testid="user">{ctx.user ? ctx.user.email : 'none'}</span>;
}

function mockFetch(deleteResponse, emailResponses = {}) {
  const fetchMock = vi.fn(async (url) => {
    if (emailResponses[url]) return emailResponses[url];
    if (url === '/auth/user') return fetchResponse(SIGNED_IN);
    if (url === '/auth/providers') return fetchResponse({ google: true, facebook: true });
    if (url === '/auth/account') return deleteResponse;
    return fetchResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderSignedIn() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('hiker@example.com');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe('AuthContext', () => {
  it('exposes the configured providers', async () => {
    mockFetch();
    await renderSignedIn();
    await waitFor(() => expect(captured.current.providers).toEqual({ google: true, facebook: true }));
  });

  it('deleteAccount sends a credentialed DELETE and clears account and device state', async () => {
    const fetchMock = mockFetch(fetchResponse({ success: true }));
    localStorage.setItem('rotv-favorites', '[1,2]');
    localStorage.setItem('rotv-newsletter-email', 'hiker@example.com');
    await renderSignedIn();

    await act(() => captured.current.deleteAccount());

    expect(fetchMock).toHaveBeenCalledWith('/auth/account', { method: 'DELETE', credentials: 'include' });
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(captured.current.favorites).toEqual([]);
    expect(localStorage.getItem('rotv-favorites')).toBeNull();
    expect(localStorage.getItem('rotv-newsletter-email')).toBeNull();
  });

  it('deleteAccount keeps the session state when the server refuses', async () => {
    mockFetch(fetchResponse({ error: 'Admin accounts cannot be deleted from the interface.' }, { status: 403 }));
    localStorage.setItem('rotv-favorites', '[1,2]');
    await renderSignedIn();

    await act(() => expect(captured.current.deleteAccount()).rejects.toThrow('Admin accounts cannot be deleted'));

    expect(screen.getByTestId('user').textContent).toBe('hiker@example.com');
    expect(localStorage.getItem('rotv-favorites')).toBe('[1,2]');
  });

  it('deleteAccount reports a generic error for a non-JSON failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')) });
    await renderSignedIn();
    await act(() => expect(captured.current.deleteAccount()).rejects.toThrow('Account deletion failed'));
  });

  it('startEmailLogin posts the address and returns the server message', async () => {
    const fetchMock = mockFetch(undefined, {
      '/auth/email/start': fetchResponse({ success: true, message: 'On the way.' })
    });
    await renderSignedIn();
    let message;
    await act(async () => { message = await captured.current.startEmailLogin('a@example.com'); });
    expect(message).toBe('On the way.');
    expect(fetchMock).toHaveBeenCalledWith('/auth/email/start', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ email: 'a@example.com' })
    }));
  });

  it('verifyEmailLogin surfaces the server error, and on success refreshes the user and syncs device data', async () => {
    const fetchMock = mockFetch(undefined, {
      '/auth/email/verify': fetchResponse({ error: 'That link or code is invalid or has expired.' }, { status: 400 })
    });
    await renderSignedIn();
    await act(() => expect(captured.current.verifyEmailLogin({ email: 'a@example.com', code: '000000' }))
      .rejects.toThrow('invalid or has expired'));

    fetchMock.mockImplementation(async (url) => {
      if (url === '/auth/email/verify') return fetchResponse({ success: true });
      if (url === '/auth/user') return fetchResponse(SIGNED_IN);
      return fetchResponse({});
    });
    const userCallsBefore = fetchMock.mock.calls.filter(([url]) => url === '/auth/user').length;
    await act(() => captured.current.verifyEmailLogin({ token: 't' }));
    const userCallsAfter = fetchMock.mock.calls.filter(([url]) => url === '/auth/user').length;
    expect(userCallsAfter - userCallsBefore).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/auth/email/verify', expect.objectContaining({ body: JSON.stringify({ token: 't' }) }));
  });
});
