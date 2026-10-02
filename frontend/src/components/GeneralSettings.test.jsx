import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const auth = { user: null, isAdmin: false, deleteAccount: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: GeneralSettings } = await import('./GeneralSettings');

beforeEach(() => {
  navigate.mockReset();
  auth.user = { id: 5, email: 'hiker@example.com', name: 'Hiker' };
  auth.isAdmin = false;
  auth.deleteAccount = vi.fn();
});

afterEach(cleanup);

describe('GeneralSettings account deletion', () => {
  it('is hidden when signed out and for admins', () => {
    auth.user = null;
    const { unmount } = render(<GeneralSettings />);
    expect(screen.queryByText('Your Account')).toBeNull();
    unmount();

    auth.user = { id: 1, email: 'admin@example.com' };
    auth.isAdmin = true;
    render(<GeneralSettings />);
    expect(screen.queryByText('Your Account')).toBeNull();
  });

  it('asks for confirmation and can be cancelled without deleting', () => {
    render(<GeneralSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(screen.getByRole('button', { name: 'Yes, delete everything' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeTruthy();
    expect(auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('shows the error on failure, allows a retry, and navigates home on success', async () => {
    auth.deleteAccount
      .mockRejectedValueOnce(new Error('Account deletion failed. Nothing was deleted; please try again.'))
      .mockResolvedValueOnce();
    render(<GeneralSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete everything' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing was deleted/);
    expect(navigate).not.toHaveBeenCalled();

    const retry = screen.getByRole('button', { name: 'Yes, delete everything' });
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(auth.deleteAccount).toHaveBeenCalledTimes(2);
  });
});
