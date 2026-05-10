import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './FeedbackForm.css';

const TYPES = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'general', label: 'General Feedback' }
];

function FeedbackForm({ onClose }) {
  const [type, setType] = useState('general');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmed = message.trim();
    if (trimmed.length < 10) {
      setError('Message must be at least 10 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message: trimmed,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          hp
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      setSuccess(data.issueNumber);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="feedback-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="feedback-modal">
        <button className="feedback-close" onClick={onClose}>&times;</button>

        {success ? (
          <div className="feedback-success">
            <div className="success-icon">&#10003;</div>
            <h3>Thank you for your feedback!</h3>
            <p>Your submission has been recorded as issue #{success}.</p>
            <button className="feedback-done-btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <h2>Send Feedback</h2>
            <p className="feedback-subtitle">Help us improve Roots of the Valley</p>

            <form className="feedback-form" onSubmit={handleSubmit}>
              <div className="feedback-field">
                <label>What kind of feedback?</label>
                <div className="feedback-radio-group">
                  {TYPES.map((t) => (
                    <label key={t.value} className={`feedback-radio-label ${type === t.value ? 'selected' : ''}`}>
                      <input
                        type="radio"
                        name="feedback-type"
                        value={t.value}
                        checked={type === t.value}
                        onChange={() => setType(t.value)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="feedback-field">
                <label htmlFor="feedback-message">Message</label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  maxLength={1000}
                  required
                />
                <span className={`feedback-char-count ${message.length > 900 ? 'near-limit' : ''}`}>
                  {message.length}/1000
                </span>
              </div>

              <div className="feedback-field">
                <label htmlFor="feedback-name">Name <span className="field-optional">(optional)</span></label>
                <input
                  type="text"
                  id="feedback-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  maxLength={100}
                />
              </div>

              <div className="feedback-field">
                <label htmlFor="feedback-email">Email <span className="field-optional">(optional, if you'd like a response)</span></label>
                <input
                  type="email"
                  id="feedback-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>

              {/* Honeypot */}
              <div className="feedback-hp" aria-hidden="true">
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                />
              </div>

              {error && <div className="feedback-error">{error}</div>}

              <button type="submit" className="feedback-submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Send Feedback'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

export default FeedbackForm;
