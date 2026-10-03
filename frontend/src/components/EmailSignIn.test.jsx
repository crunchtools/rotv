import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const auth = { startEmailLogin: vi.fn(), verifyEmailLogin: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: EmailSignIn } = await import('./EmailSignIn');

beforeEach(() => {
  auth.startEmailLogin = vi.fn().mockResolvedValue('A sign-in link and code are on the way.');
  auth.verifyEmailLogin = vi.fn().mockResolvedValue();
});

afterEach(cleanup);

function requestCode(address = 'hiker@example.com') {
  fireEvent.change(screen.getByLabelText('Sign in with email'), { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
}

describe('EmailSignIn', () => {
  it('requests a link, then signs in with the 6-digit code', async () => {
    const onSignedIn = vi.fn();
    render(<EmailSignIn onSignedIn={onSignedIn} />);
    requestCode();
    expect(await screen.findByText('A sign-in link and code are on the way.')).toBeTruthy();
    expect(auth.startEmailLogin).toHaveBeenCalledWith('hiker@example.com');

    const codeBox = screen.getByLabelText('Enter the 6-digit code');
    fireEvent.change(codeBox, { target: { value: '12a3 456789' } });
    expect(codeBox.value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(auth.verifyEmailLogin).toHaveBeenCalledWith({ email: 'hiker@example.com', code: '123456' });
  });

  it('shows the server error and stays on the step that failed', async () => {
    auth.startEmailLogin.mockRejectedValueOnce(new Error("We couldn't send the email. Please try again in a few minutes."));
    render(<EmailSignIn />);
    requestCode();
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't send/);
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeTruthy();
  });

  it('a wrong code keeps the code box open, and "use a different email" starts over', async () => {
    auth.verifyEmailLogin.mockRejectedValueOnce(new Error('That link or code is invalid or has expired.'));
    render(<EmailSignIn />);
    requestCode();
    const codeBox = await screen.findByLabelText('Enter the 6-digit code');
    fireEvent.change(codeBox, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid or has expired/);
    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Sign in with email')).toBeTruthy();
  });
});
