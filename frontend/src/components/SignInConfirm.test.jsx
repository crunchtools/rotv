import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const auth = { confirmEmail: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: SignInConfirm } = await import('./SignInConfirm');

function at(hash) {
  window.history.replaceState({}, '', `/signin${hash}`);
}

beforeEach(() => {
  navigate.mockReset();
  auth.confirmEmail = vi.fn().mockResolvedValue({ success: true, needsSignupCompletion: false });
});

afterEach(cleanup);

describe('SignInConfirm', () => {
  it('confirms as soon as it opens, once, and offers the map', async () => {
    at('#token=abc123');
    render(<SignInConfirm />);
    expect(window.location.hash).toBe('');
    expect(await screen.findByRole('heading', { name: 'Your email is confirmed' })).toBeTruthy();
    expect(auth.confirmEmail).toHaveBeenCalledTimes(1);
    expect(auth.confirmEmail).toHaveBeenCalledWith('abc123');
    fireEvent.click(screen.getByRole('button', { name: 'Go to the map' }));
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('explains a missing token without calling the server', () => {
    at('');
    render(<SignInConfirm />);
    expect(screen.getByRole('alert').textContent).toMatch(/incomplete/);
    expect(auth.confirmEmail).not.toHaveBeenCalled();
  });

  it('shows an expired-link error with a way to get a new one', async () => {
    auth.confirmEmail.mockRejectedValueOnce(new Error('That confirmation link has expired or was already used.'));
    at('#token=old');
    render(<SignInConfirm />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new confirmation email' }));
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('sends an account that still needs its details to finish sign-up', async () => {
    auth.confirmEmail.mockResolvedValueOnce({ success: true, needsSignupCompletion: true });
    at('#token=first');
    render(<SignInConfirm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Go to the map' }));
    expect(navigate).toHaveBeenCalledWith('/welcome');
  });
});
