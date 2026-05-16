import React, { useState, useEffect, useRef } from 'react';
import { handleRovingKeyDown } from '../utils/a11yUtils';
import FeedbackForm from './FeedbackForm';
import PrivacyPolicy from './PrivacyPolicy';
import MarkdownRenderer from './MarkdownRenderer';

function AboutEditor({ contentKey, content, onSave }) {
  const [draft, setDraft] = useState(content || '');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(content || '');
  }, [content]);

  // Auto-resize textarea
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
      const res = await fetch(`/api/admin/settings/${contentKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: draft })
      });
      if (!res.ok) throw new Error('Save failed');
      onSave(contentKey, draft);
    } catch (err) {
      console.error('Error saving about content:', err);
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

function AboutStory({ content, isAdmin, editMode }) {
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const handleSave = (key, newContent) => {
    if (key) setLocalContent(newContent);
    setEditing(false);
  };

  return (
    <div className="about-story">
      {isAdmin && editMode && !editing && (
        <button className="about-edit-btn" onClick={() => setEditing(true)}>Edit</button>
      )}
      {editing ? (
        <AboutEditor contentKey="about_story_md" content={localContent} onSave={handleSave} />
      ) : (
        <MarkdownRenderer content={localContent} className="about-story-content" />
      )}
    </div>
  );
}

function AboutTutorial({ onStartTour, content, isAdmin, editMode }) {
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const handleSave = (key, newContent) => {
    if (key) setLocalContent(newContent);
    setEditing(false);
  };

  return (
    <div className="about-tutorial">
      {isAdmin && editMode && !editing && (
        <button className="about-edit-btn" onClick={() => setEditing(true)}>Edit</button>
      )}
      {editing ? (
        <AboutEditor contentKey="about_tutorial_md" content={localContent} onSave={handleSave} />
      ) : (
        <MarkdownRenderer content={localContent} className="about-tutorial-content" />
      )}
      <button className="about-tour-btn" onClick={onStartTour}>
        Take a Tour
      </button>
    </div>
  );
}

function AboutPage({ onStartTour, aboutTab, onTabChange, isAdmin, editMode }) {
  const [aboutContent, setAboutContent] = useState({});

  useEffect(() => {
    fetch('/api/about-content')
      .then(res => res.ok ? res.json() : {})
      .then(data => setAboutContent(data))
      .catch(() => {});
  }, []);

  return (
    <div className="about-page">
      <div className="settings-tabs-wrapper" onKeyDown={(e) => handleRovingKeyDown(e, '.about-tab-btn')}>
        <nav className="settings-tabs" role="tablist" aria-label="About sections">
          <button
            className={`settings-tab-btn about-tab-btn ${aboutTab === 'story' ? 'active' : ''}`}
            onClick={() => onTabChange('story')}
            tabIndex={aboutTab === 'story' ? 0 : -1}
            role="tab"
            aria-selected={aboutTab === 'story'}
          >
            Story
          </button>
          <button
            className={`settings-tab-btn about-tab-btn ${aboutTab === 'tutorial' ? 'active' : ''}`}
            onClick={() => onTabChange('tutorial')}
            tabIndex={aboutTab === 'tutorial' ? 0 : -1}
            role="tab"
            aria-selected={aboutTab === 'tutorial'}
          >
            Tutorial
          </button>
          <button
            className={`settings-tab-btn about-tab-btn ${aboutTab === 'feedback' ? 'active' : ''}`}
            onClick={() => onTabChange('feedback')}
            tabIndex={aboutTab === 'feedback' ? 0 : -1}
            role="tab"
            aria-selected={aboutTab === 'feedback'}
          >
            Feedback
          </button>
          <button
            className={`settings-tab-btn about-tab-btn ${aboutTab === 'privacy' ? 'active' : ''}`}
            onClick={() => onTabChange('privacy')}
            tabIndex={aboutTab === 'privacy' ? 0 : -1}
            role="tab"
            aria-selected={aboutTab === 'privacy'}
          >
            Privacy
          </button>
        </nav>
      </div>

      <div className="about-tab-content" role="tabpanel">
        {aboutTab === 'story' && (
          <AboutStory content={aboutContent.about_story_md} isAdmin={isAdmin} editMode={editMode} />
        )}
        {aboutTab === 'tutorial' && (
          <AboutTutorial onStartTour={onStartTour} content={aboutContent.about_tutorial_md} isAdmin={isAdmin} editMode={editMode} />
        )}
        {aboutTab === 'feedback' && <FeedbackForm inline />}
        {aboutTab === 'privacy' && (
          <PrivacyPolicy inline content={aboutContent.about_privacy_md} isAdmin={isAdmin} editMode={editMode} />
        )}
      </div>
    </div>
  );
}

export default AboutPage;
