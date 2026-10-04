import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@simplewebauthn/browser', () => ({ browserSupportsWebAuthn: () => true }));

const auth = {};
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: SignInMethods } = await import('./SignInMethods');
const { default: AccountProfile } = await import('./AccountProfile');

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

describe('AccountProfile', () => {
  it('shows a quiet resend line only while the email is unconfirmed', async () => {
    auth.checkUsername = vi.fn().mockResolvedValue({ available: true });
    auth.updateProfile = vi.fn().mockResolvedValue();
    auth.user = { ...auth.user, fullName: 'Jane', emailVerified: false };
    const { unmount } = render(<AccountProfile />);
    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/We sent a new confirmation email/);
    unmount();

    auth.user = { ...auth.user, emailVerified: true };
    render(<AccountProfile />);
    expect(screen.queryByRole('button', { name: 'Resend confirmation email' })).toBeNull();
    expect(screen.queryByText(/Not confirmed/)).toBeNull();
  });
});
