import React, { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,29}$/;

/**
 * Full name, optional username, and "Show me as" (spec 046). Used by sign-up,
 * the finish-sign-up page and Settings. The username is checked against the
 * server as the person types.
 *
 * @param {{value: {name: string, username: string, displayPreference: 'name'|'username'},
 *   onChange: (next: object) => void, idPrefix: string}} props
 */
function ProfileFields({ value, onChange, idPrefix }) {
  const { checkUsername } = useAuth();
  const [usernameStatus, setUsernameStatus] = useState(null);
  const username = value.username.trim();

  useEffect(() => {
    if (!username) {
      setUsernameStatus(null);
      return undefined;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setUsernameStatus({ ok: false, text: 'Use 3 to 30 letters, numbers, dashes or underscores, starting with a letter.' });
      return undefined;
    }
    let current = true;
    const timer = setTimeout(() => {
      checkUsername(username)
        .then((result) => {
          if (current) setUsernameStatus({ ok: result.available, text: result.available ? 'Available' : result.error });
        })
        .catch((err) => {
          console.warn('Username check failed:', err);
          if (current) setUsernameStatus(null);
        });
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [username, checkUsername]);

  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });

  return (
    <fieldset className="auth-fieldset">
      <label className="auth-label" htmlFor={`${idPrefix}-name`}>Full name</label>
      <input
        id={`${idPrefix}-name`}
        className="auth-input"
        autoComplete="name"
        value={value.name}
        onChange={set('name')}
        maxLength={100}
        required
      />

      <label className="auth-label" htmlFor={`${idPrefix}-username`}>
        Username <span className="auth-optional">(optional)</span>
      </label>
      <input
        id={`${idPrefix}-username`}
        className="auth-input"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={value.username}
        onChange={set('username')}
        maxLength={30}
        aria-describedby={`${idPrefix}-username-status`}
      />
      <p id={`${idPrefix}-username-status`} className={`auth-hint ${usernameStatus && !usernameStatus.ok ? 'auth-hint-error' : ''}`}>
        {usernameStatus?.text || 'Letters, numbers, dashes or underscores.'}
      </p>

      <div className="auth-radio-group" role="radiogroup" aria-label="Show me as">
        <span className="auth-label">Show me as</span>
        <label className="auth-radio">
          <input
            type="radio"
            name={`${idPrefix}-display`}
            value="name"
            checked={value.displayPreference === 'name'}
            onChange={set('displayPreference')}
          />
          {value.name.trim() || 'My full name'}
        </label>
        <label className={`auth-radio ${username ? '' : 'auth-radio-disabled'}`}>
          <input
            type="radio"
            name={`${idPrefix}-display`}
            value="username"
            checked={value.displayPreference === 'username'}
            onChange={set('displayPreference')}
            disabled={!username}
          />
          {username || 'My username'}
        </label>
      </div>
    </fieldset>
  );
}

export default ProfileFields;
