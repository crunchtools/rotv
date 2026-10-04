import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { useContext, useEffect } from 'react';
import { AuthContext, AuthProvider } from './AuthContext';
import { fetchResponse } from '../test/fetchResponse';

vi.mock('../utils/analytics', () => ({ track: vi.fn() }));

const webauthn = { startRegistration: vi.fn(), startAuthentication: vi.fn() };
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args) => webauthn.startRegistration(...args),
  startAuthentication: (...args) => webauthn.startAuthentication(...args)
}));

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

  it('requestPasswordReset posts the address and returns the server message', async () => {
    const fetchMock = mockFetch(undefined, {
      '/auth/password/forgot': fetchResponse({ success: true, message: "If there's an account, a link is on the way." })
    });
    await renderSignedIn();
    let message;
    await act(async () => { message = await captured.current.requestPasswordReset('a@example.com'); });
    expect(message).toMatch(/If there's an account/);
    expect(fetchMock).toHaveBeenCalledWith('/auth/password/forgot', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ email: 'a@example.com' })
    }));
  });

  it('resetPassword surfaces the server error, and on success refreshes the user and syncs device data', async () => {
    const fetchMock = mockFetch(undefined, {
      '/auth/password/reset': fetchResponse({ error: 'That reset link has expired or was already used.' }, { status: 400 })
    });
    await renderSignedIn();
    await act(() => expect(captured.current.resetPassword('old', 'a new long passphrase')).rejects.toThrow('expired'));

    fetchMock.mockImplementation(async (url) => {
      if (url === '/auth/password/reset') return fetchResponse({ success: true });
      if (url === '/auth/user') return fetchResponse(SIGNED_IN);
      return fetchResponse({});
    });
    const userCallsBefore = fetchMock.mock.calls.filter(([url]) => url === '/auth/user').length;
    await act(() => captured.current.resetPassword('t', 'a new long passphrase'));
    const userCallsAfter = fetchMock.mock.calls.filter(([url]) => url === '/auth/user').length;
    expect(userCallsAfter - userCallsBefore).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith('/auth/password/reset', expect.objectContaining({
      body: JSON.stringify({ token: 't', password: 'a new long passphrase' })
    }));
  });

  it('confirmEmail sends the link token and signs in', async () => {
    const fetchMock = mockFetch(undefined, {
      '/auth/email/verify': fetchResponse({ success: true, needsSignupCompletion: false })
    });
    await renderSignedIn();
    expect(await act(() => captured.current.confirmEmail('c'))).toEqual({ success: true, needsSignupCompletion: false });
    expect(fetchMock).toHaveBeenCalledWith('/auth/email/verify', expect.objectContaining({ body: JSON.stringify({ token: 'c' }) }));
  });

  describe('sign-up and sign-in (spec 046)', () => {
    const postedTo = (fetchMock, url) => fetchMock.mock.calls.filter(([u, opts]) => u === url && opts?.method === 'POST');

    it('signs up with a password, then refreshes the account', async () => {
      const fetchMock = mockFetch();
      await renderSignedIn();
      const before = fetchMock.mock.calls.filter(([u]) => u === '/auth/user').length;

      const result = await act(() => captured.current.signUp({ email: 'a@example.com', method: 'password', password: 'p' }));

      expect(result).toEqual({ passkeySaved: true });
      expect(JSON.parse(postedTo(fetchMock, '/auth/signup')[0][1].body)).toMatchObject({ method: 'password' });
      expect(fetchMock.mock.calls.filter(([u]) => u === '/auth/user').length).toBeGreaterThan(before);
      expect(webauthn.startRegistration).not.toHaveBeenCalled();
    });

    it('creates the passkey after a passkey sign-up, and reports a cancelled one without throwing', async () => {
      const fetchMock = mockFetch(undefined, {
        '/auth/passkey/register/options': fetchResponse({ challenge: 'c' }),
        '/auth/passkey/register/verify': fetchResponse({ passkey: { id: 1, name: 'Mac' } })
      });
      await renderSignedIn();
      webauthn.startRegistration.mockResolvedValueOnce({ id: 'cred' });
      expect(await act(() => captured.current.signUp({ email: 'a@example.com', method: 'passkey' }))).toEqual({ passkeySaved: true });
      expect(webauthn.startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } });
      expect(JSON.parse(postedTo(fetchMock, '/auth/passkey/register/verify')[0][1].body).response).toEqual({ id: 'cred' });

      vi.spyOn(console, 'warn').mockImplementation(() => {});
      webauthn.startRegistration.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
      expect(await act(() => captured.current.signUp({ email: 'b@example.com', method: 'passkey' }))).toEqual({ passkeySaved: false });
    });

    it('signs in with a passkey, passing autofill through', async () => {
      const fetchMock = mockFetch(undefined, {
        '/auth/passkey/login/options': fetchResponse({ challenge: 'l' })
      });
      await renderSignedIn();
      webauthn.startAuthentication.mockResolvedValueOnce({ id: 'cred' });
      await act(() => captured.current.loginWithPasskey({ autofill: true }));
      expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'l' }, useBrowserAutofill: true });
      expect(postedTo(fetchMock, '/auth/passkey/login/verify')).toHaveLength(1);
    });

    it('surfaces a wrong password and flags stale sign-ins for re-authentication', async () => {
      mockFetch(undefined, {
        '/auth/password/login': fetchResponse({ error: 'Email or password is incorrect.' }, { ok: false, status: 401 }),
        '/auth/password': fetchResponse({ error: 'Log in again.', reauth: true }, { ok: false, status: 403 })
      });
      await renderSignedIn();
      await expect(captured.current.loginWithPassword('a@example.com', 'x')).rejects.toThrow('Email or password is incorrect.');
      await expect(captured.current.setPassword('another long one')).rejects.toMatchObject({ reauth: true });
    });
  });
});
