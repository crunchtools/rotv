import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const auth = { verifyEmailLogin: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: SignInConfirm } = await import('./SignInConfirm');

function at(hash) {
  window.history.replaceState({}, '', `/signin${hash}`);
}

beforeEach(() => {
  navigate.mockReset();
  auth.verifyEmailLogin = vi.fn().mockResolvedValue();
});

afterEach(cleanup);

describe('SignInConfirm', () => {
  it('waits for a click before using the token, then goes home', async () => {
    at('#token=abc123');
    render(<SignInConfirm />);
    expect(auth.verifyEmailLogin).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Finish signing in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(auth.verifyEmailLogin).toHaveBeenCalledWith({ token: 'abc123' });
  });

  it('explains a missing token without offering to sign in', () => {
    at('');
    render(<SignInConfirm />);
    expect(screen.getByRole('alert').textContent).toMatch(/incomplete/);
    expect(screen.queryByRole('button', { name: 'Finish signing in' })).toBeNull();
  });

  it('shows an expired-link error with a way back', async () => {
    auth.verifyEmailLogin.mockRejectedValueOnce(new Error('That link or code is invalid or has expired.'));
    at('#token=old');
    render(<SignInConfirm />);
    fireEvent.click(screen.getByRole('button', { name: 'Finish signing in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    fireEvent.click(screen.getByRole('button', { name: /request a new link/ }));
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
