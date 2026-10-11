import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import AccountProfile from './AccountProfile';
import { useAuth } from '../../hooks/useAuth';

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));

const auth = (overrides = {}) => {
  const value = {
    user: { email: 'scott@example.com', emailVerified: true, fullName: 'Scott McCarty', username: '', displayPreference: 'name' },
    contact: {},
    updateProfile: vi.fn().mockResolvedValue(),
    setContact: vi.fn().mockResolvedValue(true),
    resendConfirmation: vi.fn(),
    checkUsername: vi.fn().mockResolvedValue({ available: true }),
    ...overrides
  };
  useAuth.mockReturnValue(value);
  return value;
};

afterEach(cleanup);

describe('AccountProfile', () => {
  it('asks for the name once, as first and last, starting from the account', () => {
    auth();
    render(<AccountProfile />);

    expect(screen.getByLabelText('First name').value).toBe('Scott');
    expect(screen.getByLabelText('Last name').value).toBe('McCarty');
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });

  it('saves the name to the account and the details to the contact in one go', async () => {
    const { updateProfile, setContact } = auth({ contact: { firstName: 'Scott', lastName: 'McCarty', city: 'Akron' } });
    render(<AccountProfile />);

    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'M.' } });
    fireEvent.change(screen.getByLabelText('Cell number'), { target: { value: ' 330-555-0100 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(setContact).toHaveBeenCalledWith({
      firstName: 'Scott', lastName: 'M.', address: '', city: 'Akron', state: '', zip: '', phone: '330-555-0100'
    }));
    expect(updateProfile).toHaveBeenCalledWith({ name: 'Scott M.', username: '', displayPreference: 'name' });
    expect((await screen.findByRole('status')).textContent).toBe('Saved.');
  });

  it('says which half was saved when the details could not be', async () => {
    auth({ setContact: vi.fn().mockResolvedValue(false) });
    render(<AccountProfile />);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await screen.findByRole('status')).textContent).toMatch(/name was saved, but not your address/);
  });

  it('will not save without a name', () => {
    auth({ user: { email: 'new@example.com', emailVerified: true, fullName: '' } });
    render(<AccountProfile />);

    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });
});
