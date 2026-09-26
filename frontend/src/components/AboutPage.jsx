import React, { useState, useEffect } from 'react';
import { handleRovingKeyDown } from '../utils/a11yUtils';
import FeedbackForm from './FeedbackForm';
import PrivacyPolicy from './PrivacyPolicy';
import MarkdownRenderer from './MarkdownRenderer';
import MarkdownContentEditor from './MarkdownContentEditor';

function EditableMarkdownSection({ className, contentKey, content, isAdmin, editMode, children }) {
  const [editing, setEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const handleSaved = (newContent) => {
    setLocalContent(newContent);
    setEditing(false);
  };

  return (
    <div className={className}>
      {isAdmin && editMode && !editing && (
        <button className="about-edit-btn" onClick={() => setEditing(true)}>Edit</button>
      )}
      {editing ? (
        <MarkdownContentEditor
          contentKey={contentKey}
          content={localContent}
          onSaved={handleSaved}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <MarkdownRenderer content={localContent} className={`${className}-content`} />
      )}
      {children}
    </div>
  );
}

function AboutTutorial({ onStartTour, content, contentKey, buttonLabel, isAdmin, editMode }) {
  return (
    <EditableMarkdownSection
      className="about-tutorial"
      contentKey={contentKey}
      content={content}
      isAdmin={isAdmin}
      editMode={editMode}
    >
      <button className="about-tour-btn" onClick={onStartTour}>
        {buttonLabel}
      </button>
    </EditableMarkdownSection>
  );
}

function AboutPage({ onStartTour, onStartTripTour, aboutTab, onTabChange, isAdmin, editMode }) {
  const [aboutContent, setAboutContent] = useState({});

  useEffect(() => {
    fetch('/api/about-content')
      .then(res => res.ok ? res.json() : {})
      .then(setAboutContent)
      .catch((err) => console.error('Failed to load about content:', err));
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
            Tutorials
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
          <EditableMarkdownSection
            className="about-story"
            contentKey="about_story_md"
            content={aboutContent.about_story_md}
            isAdmin={isAdmin}
            editMode={editMode}
          />
        )}
        {aboutTab === 'tutorial' && (
          <>
            <AboutTutorial
              onStartTour={onStartTour}
              content={aboutContent.about_tutorial_md}
              contentKey="about_tutorial_md"
              buttonLabel="Take a Tour"
              isAdmin={isAdmin}
              editMode={editMode}
            />
            <AboutTutorial
              onStartTour={onStartTripTour}
              content={aboutContent.about_trip_tutorial_md}
              contentKey="about_trip_tutorial_md"
              buttonLabel="Take the Trip Planning Tour"
              isAdmin={isAdmin}
              editMode={editMode}
            />
          </>
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
