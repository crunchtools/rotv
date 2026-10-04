import React from 'react';

/**
 * The sign-up checkboxes (spec 046): age and terms are required, the
 * newsletter is optional and checked by default (Scott: encourage sign-ups).
 *
 * @param {{value: {ageConfirmed: boolean, termsAccepted: boolean, newsletter: boolean},
 *   onChange: (next: object) => void}} props
 */
function ConsentFields({ value, onChange }) {
  const toggle = (field) => (e) => onChange({ ...value, [field]: e.target.checked });
  return (
    <fieldset className="auth-fieldset auth-consents">
      <label className="auth-check">
        <input type="checkbox" checked={value.ageConfirmed} onChange={toggle('ageConfirmed')} required />
        I&apos;m 13 or older
      </label>
      <label className="auth-check">
        <input type="checkbox" checked={value.termsAccepted} onChange={toggle('termsAccepted')} required />
        <span>
          I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> and{' '}
          <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>
        </span>
      </label>
      <label className="auth-check">
        <input type="checkbox" checked={value.newsletter} onChange={toggle('newsletter')} />
        Send me the Friday newsletter
      </label>
    </fieldset>
  );
}

export default ConsentFields;
