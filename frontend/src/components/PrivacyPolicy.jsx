import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import MarkdownRenderer from './MarkdownRenderer';
import BackButton from './BackButton';
import MarkdownContentEditor from './MarkdownContentEditor';

function PrivacyPolicy({ inline = false, content, isAdmin, editMode }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);
  const [standaloneContent, setStandaloneContent] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  useEffect(() => {
    if (!inline && !content) {
      fetch('/api/about-content')
        .then(res => res.ok ? res.json() : {})
        .then(aboutContent => {
          if (aboutContent.about_privacy_md) {
            setStandaloneContent(aboutContent.about_privacy_md);
          }
        })
        .catch(err => {
          console.error('Error loading privacy policy:', err);
          setLoadError('Could not load the privacy policy. Please try again later.');
        });
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
          <BackButton onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')} />
        )}

        {isAdmin && editMode && !editing && (
          <button className="about-edit-btn" onClick={() => setEditing(true)}>Edit</button>
        )}

        {editing ? (
          <MarkdownContentEditor
            contentKey="about_privacy_md"
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
