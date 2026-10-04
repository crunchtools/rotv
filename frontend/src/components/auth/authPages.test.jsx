import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const webauthn = { supported: true, autofill: false };
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => webauthn.supported,
  browserSupportsWebAuthnAutofill: async () => webauthn.autofill
}));

const auth = {};
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: SignupPage } = await import('./SignupPage');
const { default: LoginPage } = await import('./LoginPage');
const { default: WelcomePage } = await import('./WelcomePage');

beforeEach(() => {
  navigate.mockReset();
  webauthn.supported = true;
  webauthn.autofill = false;
  Object.assign(auth, {
    user: null,
    loading: false,
    providers: { google: true, email: true, password: true, passkey: true },
    loginWithGoogle: vi.fn(),
    signUp: vi.fn().mockResolvedValue({ passkeySaved: true }),
    loginWithPassword: vi.fn().mockResolvedValue(),
    loginWithPasskey: vi.fn().mockResolvedValue(),
    completeSignup: vi.fn().mockResolvedValue(),
    checkUsername: vi.fn().mockResolvedValue({ available: true }),
    startEmailLogin: vi.fn(),
    verifyEmailLogin: vi.fn()
  });
});

afterEach(cleanup);

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('SignupPage', () => {
  it('starts with Google or email, and shows the form only after choosing email', () => {
    render(<SignupPage />);
    expect(screen.queryByLabelText('Email')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect(auth.loginWithGoogle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Sign up with email/ }));
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });

  it('needs the age and terms boxes before creating a password account', async () => {
    render(<SignupPage />);
    fireEvent.click(screen.getByRole('button', { name: /Sign up with email/ }));
    fill('Full name', 'Jane Hiker');
    fill('Email', 'jane@example.com');
    fill('Password', 'correct horse battery staple');
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("I'm 13 or older"));
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/?welcome=1'));
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Hiker', email: 'jane@example.com', method: 'password',
      password: 'correct horse battery staple', ageConfirmed: true, termsAccepted: true, newsletter: false
    }));
  });

  it('swaps the password for a passkey, and hides the option without WebAuthn', async () => {
    auth.signUp.mockResolvedValueOnce({ passkeySaved: false });
    const { unmount } = render(<SignupPage />);
    fireEvent.click(screen.getByRole('button', { name: /Sign up with email/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use a passkey instead' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fill('Full name', 'Jane');
    fill('Email', 'jane@example.com');
    fireEvent.click(screen.getByLabelText("I'm 13 or older"));
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/?welcome=nopasskey'));
    expect(auth.signUp.mock.calls[0][0]).toMatchObject({ method: 'passkey', password: undefined });
    unmount();

    webauthn.supported = false;
    render(<SignupPage />);
    fireEvent.click(screen.getByRole('button', { name: /Sign up with email/ }));
    expect(screen.queryByRole('button', { name: 'Use a passkey instead' })).toBeNull();
  });

  it('shows the server error and stays on the form', async () => {
    auth.signUp.mockRejectedValueOnce(new Error('That username is taken.'));
    render(<SignupPage />);
    fireEvent.click(screen.getByRole('button', { name: /Sign up with email/ }));
    fill('Full name', 'Jane');
    fill('Email', 'jane@example.com');
    fill('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByLabelText("I'm 13 or older"));
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That username is taken.');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('LoginPage', () => {
  it('signs in with a password after choosing email', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Continue with email/ }));
    fill('Email', 'jane@example.com');
    fill('Password', 'correct horse battery staple');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(auth.loginWithPassword).toHaveBeenCalledWith('jane@example.com', 'correct horse battery staple');
  });

  it('signs in with a passkey, and stays quiet when the person cancels', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Continue with email/ }));
    const cancelled = Object.assign(new Error('The operation was cancelled.'), { name: 'NotAllowedError' });
    auth.loginWithPasskey.mockRejectedValueOnce(cancelled);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(auth.loginWithPasskey).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('offers an emailed code for a forgotten password', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Continue with email/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByLabelText('Sign in with email')).toBeTruthy();
  });
});

describe('WelcomePage', () => {
  it('collects the profile and consents, then finishes', async () => {
    auth.user = { email: 'walker@example.com', fullName: 'Walker', needsSignupCompletion: true };
    render(<WelcomePage />);
    await waitFor(() => expect(screen.getByLabelText('Full name').value).toBe('Walker'));
    fireEvent.click(screen.getByLabelText("I'm 13 or older"));
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(auth.completeSignup).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Walker', ageConfirmed: true, termsAccepted: true
    }));
  });

  it('sends signed-out visitors to sign in and finished accounts home', () => {
    const { unmount } = render(<WelcomePage />);
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    unmount();
    auth.user = { email: 'a@example.com', needsSignupCompletion: false };
    render(<WelcomePage />);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });
});
