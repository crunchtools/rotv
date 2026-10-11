import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ContactDetails from './ContactDetails';
import { useAuth } from '../hooks/useAuth';

vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }));

const auth = (overrides = {}) => {
  const value = { user: null, contact: {}, setContact: vi.fn().mockResolvedValue(true), ...overrides };
  useAuth.mockReturnValue(value);
  return value;
};

afterEach(cleanup);

describe('ContactDetails', () => {
  it('starts the name from the account and saves every field, trimmed', async () => {
    const { setContact } = auth({ user: { fullName: 'Scott McCarty' } });
    render(<ContactDetails />);

    expect(screen.getByLabelText('First name').value).toBe('Scott');
    expect(screen.getByLabelText('Last name').value).toBe('McCarty');
    fireEvent.change(screen.getByLabelText('Mailing address'), { target: { value: ' 1 Main St ' } });
    fireEvent.change(screen.getByLabelText('Cell number'), { target: { value: '330-555-0100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(setContact).toHaveBeenCalledWith({
      firstName: 'Scott', lastName: 'McCarty', address: '1 Main St', city: '', state: '', zip: '', phone: '330-555-0100'
    }));
    expect((await screen.findByRole('status')).textContent).toContain('Details saved');
  });

  it('shows saved details, and keeps a name the person cleared cleared', () => {
    auth({ user: { fullName: 'Scott McCarty' }, contact: { firstName: '', lastName: 'M.', city: 'Akron' } });
    render(<ContactDetails />);

    expect(screen.getByLabelText('First name').value).toBe('');
    expect(screen.getByLabelText('Last name').value).toBe('M.');
    expect(screen.getByLabelText('City').value).toBe('Akron');
  });

  it('saves a cleared name as blank instead of dropping it', async () => {
    const { setContact } = auth({ user: { fullName: 'Scott McCarty' }, contact: { firstName: 'Scott', lastName: 'McCarty' } });
    render(<ContactDetails />);

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    await waitFor(() => expect(setContact).toHaveBeenCalled());
    expect(setContact.mock.calls[0][0]).toMatchObject({ firstName: '', lastName: 'McCarty' });
  });

  it('tells a signed-out visitor the details stay on the device', () => {
    auth();
    render(<ContactDetails />);

    expect(screen.getByText(/saved on this device/i)).toBeTruthy();
  });

  it('says so when saving fails', async () => {
    auth({ setContact: vi.fn().mockResolvedValue(false) });
    render(<ContactDetails />);

    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save');
  });
});
