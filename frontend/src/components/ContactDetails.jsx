import React, { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const FIELDS = [
  { id: 'firstName', label: 'First name', autoComplete: 'given-name', width: 'half' },
  { id: 'lastName', label: 'Last name', autoComplete: 'family-name', width: 'half' },
  { id: 'address', label: 'Mailing address', autoComplete: 'street-address' },
  { id: 'city', label: 'City', autoComplete: 'address-level2', width: 'city' },
  { id: 'state', label: 'State', autoComplete: 'address-level1', width: 'short' },
  { id: 'zip', label: 'ZIP', autoComplete: 'postal-code', inputMode: 'numeric', width: 'short' },
  { id: 'phone', label: 'Cell number', autoComplete: 'tel', type: 'tel', width: 'half' }
];

const NO_DETAILS = {};

/**
 * Every contact field, trimmed, blank ones included: a field the person
 * cleared must be saved as cleared.
 * @param {object} draft What is in the inputs
 * @returns {object} The whole set, as AuthContext's setContact() takes it
 */
export function contactFrom(draft) {
  return Object.fromEntries(FIELDS.map(field => [field.id, (draft[field.id] || '').trim()]));
}

/**
 * The name, mailing address and cell number inputs (spec 050), laid out as a
 * grid: used by Your Account when signed in and by Your details when not.
 *
 * @param {object} props
 * @param {object} props.value The draft, keyed as contactFrom() returns it
 * @param {(next: object) => void} props.onChange Called with the whole draft on every edit
 * @param {string[]} [props.required] Ids of fields that must be filled in
 */
export function ContactFields({ value, onChange, required = [] }) {
  return (
    <div className="settings-grid">
      {FIELDS.map(field => (
        <div className={`settings-field ${field.width || 'full'}`} key={field.id}>
          <label htmlFor={`contact-${field.id}`}>{field.label}</label>
          <input
            id={`contact-${field.id}`}
            type={field.type || 'text'}
            inputMode={field.inputMode}
            autoComplete={field.autoComplete}
            required={required.includes(field.id)}
            value={value[field.id] || ''}
            onChange={(e) => onChange({ ...value, [field.id]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Settings › General › Your details (spec 050), for a visitor who is not
 * signed in: the name, mailing address and cell number written onto forms they
 * download, such as the Fall Hiking Spree form. Kept on the device. Signed in,
 * the same fields are part of Your Account instead.
 */
export default function ContactDetails() {
  const { contact = NO_DETAILS, setContact } = useAuth();
  const [draft, setDraft] = useState(contact);
  const [status, setStatus] = useState(null);

  useEffect(() => { setDraft(contact); }, [contact]);

  const save = async (e) => {
    e.preventDefault();
    setStatus('saving');
    setStatus(await setContact(contactFrom(draft)) ? 'saved' : 'failed');
  };

  return (
    <form className="settings-card contact-details" onSubmit={save}>
      <h3>Your details</h3>
      <p className="settings-description">
        Used only to fill in forms you download here, such as the Fall Hiking Spree form.
        Saved on this device; sign in to keep them on your account.
      </p>
      <ContactFields value={draft} onChange={(next) => { setDraft(next); setStatus(null); }} />
      <div className="settings-actions">
        <button type="submit" className="save-settings-btn" disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save details'}
        </button>
        {status === 'saved' && <div className="save-message success" role="status">Details saved</div>}
        {status === 'failed' && <div className="save-message error" role="alert">Could not save your details</div>}
      </div>
    </form>
  );
}
