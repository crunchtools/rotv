import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { splitName } from '../../utils/listForm';
import { ContactFields, contactFrom } from '../ContactDetails';
import ProfileFields from './ProfileFields';

const NO_DETAILS = {};

/**
 * Settings › Your Account (specs 046 and 050): one form for who the person is.
 * Their name, username and how they are shown, and the mailing address and
 * cell number written onto forms they download; plus a quiet "Resend
 * confirmation email" while the address isn't confirmed.
 *
 * The name is asked once, as first and last: it is saved as the account's name
 * and as the name that goes on forms.
 */
function AccountProfile() {
  const { user, contact = NO_DETAILS, updateProfile, setContact, resendConfirmation } = useAuth();
  const [details, setDetails] = useState(() => {
    const fromAccount = splitName(user.fullName || '');
    return {
      ...contact,
      firstName: contact.firstName || fromAccount.first,
      lastName: contact.lastName || fromAccount.last
    };
  });
  const [shownAs, setShownAs] = useState({
    username: user.username || '',
    displayPreference: user.displayPreference || 'name'
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const name = `${details.firstName || ''} ${details.lastName || ''}`.trim();

  const act = async (action) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ type: 'success', text: await action() });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    act(async () => {
      await updateProfile({ ...shownAs, name });
      if (!await setContact(contactFrom(details))) {
        throw new Error('Your name was saved, but not your address and cell number. Please try again.');
      }
      return 'Saved.';
    });
  };

  return (
    <form className="account-profile" onSubmit={handleSave}>
      <p className="account-email">
        <span className="account-email-label">Email</span>
        {user.email}
        {!user.emailVerified && (
          <span className="account-email-note">
            {' '}· Not confirmed ·{' '}
            <button type="button" className="auth-inline-link" onClick={() => act(resendConfirmation)} disabled={busy}>
              Resend confirmation email
            </button>
          </span>
        )}
      </p>
      <ContactFields
        value={details}
        onChange={(next) => { setDetails(next); setStatus(null); }}
        required={['firstName']}
      />
      <p className="field-hint">
        Your address and cell number are used only to fill in forms you download here, such as the Fall Hiking Spree form.
      </p>
      <ProfileFields
        value={{ ...shownAs, name }}
        onChange={(next) => setShownAs({ username: next.username, displayPreference: next.displayPreference })}
        idPrefix="settings"
        nameField={false}
      />
      <div className="settings-actions">
        <button className="save-settings-btn" type="submit" disabled={busy || !name}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {status && <p className={`auth-status ${status.type}`} role="status">{status.text}</p>}
      </div>
    </form>
  );
}

export default AccountProfile;
