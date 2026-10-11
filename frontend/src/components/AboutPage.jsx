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

/**
 * The About pages: the project's story, the tutorials, feedback and privacy.
 *
 * @param {object} props
 * @param {() => void} props.onStartTour Starts the Navigation tour
 * @param {() => void} props.onStartTripTour Starts the Trip Planning tour
 * @param {(() => void)|null} [props.onStartListTour] Starts the tour of the featured curated list
 *   (spec 050). Null while no featured list is in season, and its tutorial section is then left out
 * @param {string} [props.listName] That list's name, for the button: "Take the <listName> Tour"
 * @param {'story'|'tutorial'|'feedback'|'privacy'} props.aboutTab The section shown
 * @param {(tab: string) => void} props.onTabChange Called when another section is picked
 * @param {boolean} props.isAdmin Whether the viewer may edit the text
 * @param {boolean} props.editMode Whether editing is switched on
 */
function AboutPage({ onStartTour, onStartTripTour, onStartListTour, listName, aboutTab, onTabChange, isAdmin, editMode }) {
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
            {/* Only while the featured list is in season: its tour walks the live list. */}
            {onStartListTour && (
              <AboutTutorial
                onStartTour={onStartListTour}
                content={aboutContent.about_list_tutorial_md}
                contentKey="about_list_tutorial_md"
                buttonLabel={`Take the ${listName} Tour`}
                isAdmin={isAdmin}
                editMode={editMode}
              />
            )}
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
