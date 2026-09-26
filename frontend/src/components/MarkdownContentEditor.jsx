import React, { useState, useEffect, useRef } from 'react';

const MARKDOWN_GUIDE_URL = 'https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax';

/**
 * Admin editor for a markdown page stored in admin settings under `contentKey`.
 *
 * @param {object} props
 * @param {string} props.contentKey - Settings key saved via PUT /api/admin/settings/<key>.
 * @param {string} props.content - Current saved markdown; resets the draft when it changes.
 * @param {(draft: string) => void} props.onSaved - Called with the saved text after a 2xx save.
 * @param {() => void} props.onCancel - Called after the draft is reset on Cancel.
 * Save failures are shown inline and leave the editor open.
 */
function MarkdownContentEditor({ contentKey, content, onSaved, onCancel }) {
  const [draft, setDraft] = useState(content || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(content || '');
  }, [content]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [draft]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/settings/${contentKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: draft })
      });
      if (!res.ok) throw new Error(`Save failed (HTTP ${res.status})`);
      onSaved(draft);
    } catch (err) {
      console.error(`Error saving ${contentKey}:`, err);
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(content || '');
    onCancel();
  };

  return (
    <div className="about-editor">
      <textarea
        ref={textareaRef}
        className="about-editor-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={saving}
      />
      {saveError && <div className="sync-error">{saveError}</div>}
      <div className="about-editor-actions">
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="cancel-btn" onClick={handleCancel} disabled={saving}>
          Cancel
        </button>
        <a
          href={MARKDOWN_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="about-editor-help"
        >
          Markdown Guide
        </a>
      </div>
    </div>
  );
}

export default MarkdownContentEditor;
