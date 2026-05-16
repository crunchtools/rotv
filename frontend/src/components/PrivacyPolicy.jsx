import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import MarkdownRenderer from './MarkdownRenderer';

function PrivacyEditor({ content, onSave }) {
  const [draft, setDraft] = useState(content || '');
  const [saving, setSaving] = useState(false);
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
    try {
      const res = await fetch('/api/admin/settings/about_privacy_md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: draft })
      });
      if (!res.ok) throw new Error('Save failed');
      onSave(draft);
    } catch (err) {
      console.error('Error saving privacy content:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(content || '');
    onSave(null);
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
      <div className="about-editor-actions">
        <button className="save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="cancel-btn" onClick={handleCancel} disabled={saving}>
          Cancel
        </button>
        <a
          href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
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

function PrivacyPolicy({ inline = false, content, isAdmin, editMode }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);
  const [standaloneContent, setStandaloneContent] = useState(null);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  // Standalone route: fetch content directly if not provided as prop
  useEffect(() => {
    if (!inline && !content) {
      fetch('/api/about-content')
        .then(res => res.ok ? res.json() : {})
        .then(data => {
          if (data.about_privacy_md) {
            setStandaloneContent(data.about_privacy_md);
          }
        })
        .catch(() => {});
    }
  }, [inline, content]);

  const displayContent = localContent || standaloneContent;

  const handleSave = (newContent) => {
    if (newContent) setLocalContent(newContent);
    setEditing(false);
  };

  return (
    <div className={`privacy-policy-page ${inline ? 'privacy-inline' : ''}`}>
      <div className="privacy-policy-content">
        {!inline && (
          <button className="privacy-back-btn" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}>
            &larr; Back
          </button>
        )}

        {isAdmin && editMode && !editing && (
          <button className="about-edit-btn" onClick={() => setEditing(true)}>Edit</button>
        )}

        {editing ? (
          <PrivacyEditor content={displayContent} onSave={handleSave} />
        ) : (
          <MarkdownRenderer content={displayContent} className="privacy-markdown-content" />
        )}
      </div>
    </div>
  );
}

export default PrivacyPolicy;
