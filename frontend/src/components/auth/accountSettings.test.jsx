import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => true }));

const auth = {};
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: SignInMethods } = await import('./SignInMethods');
const { default: AccountBanner } = await import('./AccountBanner');

const reauthError = () => Object.assign(new Error('For your security, log in again before changing how you sign in.'), { reauth: true });

beforeEach(() => {
  navigate.mockReset();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  Object.assign(auth, {
    user: { id: 1, email: 'jane@example.com', emailVerified: true, notice: null },
    signInMethods: vi.fn().mockResolvedValue({
      hasPassword: true, passwordAllowed: true,
      passkeys: [{ id: 3, name: 'Phone', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: null }]
    }),
    setPassword: vi.fn().mockResolvedValue({}),
    removePassword: vi.fn().mockResolvedValue({}),
    registerPasskey: vi.fn().mockResolvedValue({}),
    renamePasskey: vi.fn().mockResolvedValue({}),
    removePasskey: vi.fn().mockResolvedValue({}),
    resendConfirmation: vi.fn().mockResolvedValue('We sent a new confirmation email to jane@example.com.'),
    logout: vi.fn().mockResolvedValue()
  });
});

afterEach(cleanup);

describe('SignInMethods', () => {
  it('lists passkeys and changes the password', async () => {
    render(<SignInMethods />);
    expect(await screen.findByText('Phone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a brand new passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect((await screen.findByRole('status')).textContent).toBe('Password changed.');
    expect(auth.setPassword).toHaveBeenCalledWith('a brand new passphrase');
  });

  it('offers to sign in again when the sign-in is too old', async () => {
    auth.removePasskey.mockRejectedValueOnce(reauthError());
    render(<SignInMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Phone' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/log in again/);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login'));
    expect(auth.logout).toHaveBeenCalled();
  });

  it('hides the password controls for admins', async () => {
    auth.signInMethods.mockResolvedValueOnce({ hasPassword: false, passwordAllowed: false, passkeys: [] });
    render(<SignInMethods />);
    expect(await screen.findByRole('button', { name: 'Add a passkey' })).toBeTruthy();
    expect(screen.queryByText('Password')).toBeNull();
  });
});

describe('AccountBanner', () => {
  it('reminds an unconfirmed account and resends the email', async () => {
    auth.user = { ...auth.user, emailVerified: false };
    render(<AccountBanner />);
    expect(screen.getByText(/Confirm your email \(jane@example.com\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    expect(await screen.findByText(/We sent a new confirmation email/)).toBeTruthy();
  });

  it('welcomes a new account once and clears the query', () => {
    window.history.replaceState({}, '', '/?welcome=nopasskey&poi=x');
    render(<AccountBanner />);
    expect(screen.getByText(/passkey wasn’t saved/)).toBeTruthy();
    expect(window.location.search).toBe('?poi=x');
  });

  it('shows the credentials-reset notice and stays dismissed per account', () => {
    auth.user = { ...auth.user, notice: 'credentials_reset' };
    const { unmount } = render(<AccountBanner />);
    expect(screen.getByText(/We removed a password or passkey/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/We removed a password or passkey/)).toBeNull();
    unmount();

    render(<AccountBanner />);
    expect(screen.queryByText(/We removed/)).toBeNull();
    cleanup();
    auth.user = { id: 2, email: 'other@example.com', emailVerified: false };
    render(<AccountBanner />);
    expect(screen.getByText(/Confirm your email \(other@example.com\)/)).toBeTruthy();
  });

  it('still works when sessionStorage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    auth.user = { ...auth.user, emailVerified: false };
    render(<AccountBanner />);
    expect(screen.getByText(/Confirm your email/)).toBeTruthy();
    getItem.mockRestore();
    warn.mockRestore();
  });
});
