import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MarkdownRenderer from './MarkdownRenderer';
import BackButton from './BackButton';
import MarkdownContentEditor from './MarkdownContentEditor';

// Renders an admin-editable legal page from admin_settings. Defaults to the
// privacy policy; /data-deletion passes contentKey="about_data_deletion_md".
function PrivacyPolicy({ inline = false, content, isAdmin, editMode, contentKey = 'about_privacy_md' }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);
  const [standaloneContent, setStandaloneContent] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  useEffect(() => {
    if (inline || content) return undefined;
    // Ignore a response that lands after navigating to the other legal page.
    let current = true;
    setStandaloneContent(null);
    fetch('/api/about-content')
      .then(res => res.ok ? res.json() : {})
      .then(aboutContent => {
        if (current && aboutContent[contentKey]) {
          setStandaloneContent(aboutContent[contentKey]);
        }
      })
      .catch(err => {
        console.error('Error loading legal page:', err);
        if (current) setLoadError('Could not load this page. Please try again later.');
      });
    return () => { current = false; };
  }, [inline, content, contentKey]);

  const displayContent = localContent || standaloneContent;

  const handleSave = (newContent) => {
    if (newContent) setLocalContent(newContent);
    setEditing(false);
  };

  return (
    <div className={`privacy-policy-page ${inline ? 'privacy-inline' : ''}`}>
      <div className="privacy-policy-content">
        {!inline && (
          <BackButton onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')} />
        )}

        {isAdmin && editMode && !editing && (
          <button className="about-edit-btn" onClick={() => setEditing(true)}>Edit</button>
        )}

        {editing ? (
          <MarkdownContentEditor
            contentKey={contentKey}
            content={displayContent}
            onSaved={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : loadError && !displayContent ? (
          <div className="error-message">{loadError}</div>
        ) : (
          <MarkdownRenderer content={displayContent} className="privacy-markdown-content" />
        )}
      </div>
    </div>
  );
}

export default PrivacyPolicy;
