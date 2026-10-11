import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { splitName } from '../utils/listForm';

const FIELDS = [
  { id: 'firstName', label: 'First name', autoComplete: 'given-name' },
  { id: 'lastName', label: 'Last name', autoComplete: 'family-name' },
  { id: 'address', label: 'Mailing address', autoComplete: 'street-address' },
  { id: 'city', label: 'City', autoComplete: 'address-level2' },
  { id: 'state', label: 'State', autoComplete: 'address-level1' },
  { id: 'zip', label: 'ZIP', autoComplete: 'postal-code', inputMode: 'numeric' },
  { id: 'phone', label: 'Cell number', autoComplete: 'tel', type: 'tel' }
];

const NO_DETAILS = {};

/**
 * Settings › General › Your details (spec 050): the name, mailing address and
 * cell number written onto forms the person downloads, such as the Fall Hiking
 * Spree form. Kept on the account when signed in, on the device otherwise.
 */
export default function ContactDetails() {
  const { user, contact = NO_DETAILS, setContact } = useAuth();
  const [draft, setDraft] = useState(contact);
  const [status, setStatus] = useState(null);

  // The account's details arrive after the first render; a name not yet given
  // starts from the one on the account.
  useEffect(() => {
    const fromAccount = splitName(user?.fullName || '');
    setDraft({
      ...contact,
      firstName: contact.firstName ?? fromAccount.first,
      lastName: contact.lastName ?? fromAccount.last
    });
  }, [contact, user?.fullName]);

  const save = async (e) => {
    e.preventDefault();
    setStatus('saving');
    // Every field is saved, blank ones too: a name the person cleared must stay cleared.
    const details = Object.fromEntries(FIELDS.map(field => [field.id, (draft[field.id] || '').trim()]));
    setStatus(await setContact(details) ? 'saved' : 'failed');
  };

  return (
    <form className="settings-section contact-details" onSubmit={save}>
      <h3>Your details</h3>
      <p className="settings-description">
        Used only to fill in forms you download here, such as the Fall Hiking Spree form.
        {user ? ' Saved to your account.' : ' Saved on this device; sign in to keep them on your account.'}
      </p>
      {FIELDS.map(field => (
        <div className="settings-field" key={field.id}>
          <label htmlFor={`contact-${field.id}`}>{field.label}</label>
          <input
            id={`contact-${field.id}`}
            type={field.type || 'text'}
            inputMode={field.inputMode}
            autoComplete={field.autoComplete}
            value={draft[field.id] || ''}
            onChange={(e) => { setDraft({ ...draft, [field.id]: e.target.value }); setStatus(null); }}
          />
        </div>
      ))}
      <div className="settings-actions">
        <button type="submit" className="save-settings-btn" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save details'}
        </button>
        {status === 'saved' && <div className="save-message success" role="status">✓ Details saved</div>}
        {status === 'failed' && <div className="save-message error" role="alert">✗ Could not save your details</div>}
      </div>
    </form>
  );
}
