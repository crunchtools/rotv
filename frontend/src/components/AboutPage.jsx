import React from 'react';
import { handleRovingKeyDown } from '../utils/a11yUtils';
import FeedbackForm from './FeedbackForm';
import PrivacyPolicy from './PrivacyPolicy';

function AboutStory() {
  return (
    <div className="about-story">
      <h2>One Map for Everything Happening in the Cuyahoga Valley</h2>

      <p>
        The Cuyahoga Valley has over 300 parks, trailheads, preserves, and landmarks, but the
        information about them is scattered across dozens of websites run by the National Park
        Service, Cleveland Metroparks, Summit Metro Parks, and countless other organizations.
        A mountain biker checking whether trails are rideable might need to check TrailForks,
        Twitter, and two different park district websites. A family looking for weekend activities
        doesn't have time to visit dozens of event calendars.
      </p>

      <p>
        The result: people stick to what they already know and miss 95% of what the valley offers.
      </p>

      <p>
        <strong>Roots of the Valley fixes that.</strong> We traverse the deepest corners of the web
        to aggregate news, events, and social signals that traditional search engines miss, distilling
        them into one seamless, interactive map. Every point of interest shows its latest news,
        upcoming events, and current trail status. Open one page and immediately see what's open,
        what's happening this weekend, and what's worth discovering for the first time.
      </p>

      <hr className="about-divider" />

      <h2>Built in the Open</h2>

      <p>
        The Cuyahoga Valley is public land, maintained through shared stewardship by rangers,
        volunteers, trail crews, and the people who use it every day. Roots of the Valley works
        the same way.
      </p>

      <p>
        The entire project, code, data, and infrastructure, is open source. Anyone can see how it
        works, suggest improvements, or adapt it for their own region.
      </p>

      <p>
        <strong>Transparency.</strong> When ROTV says a trail is closed, you can trace exactly where
        that information came from. There's no opaque algorithm deciding what you see. The collection
        sources are public, the moderation queue is human-reviewed, and the codebase is
        on <a href="https://github.com/crunchtools/rotv" target="_blank" rel="noopener noreferrer">GitHub</a>.
      </p>

      <p>
        <strong>Durability.</strong> Free services disappear all the time, the company pivots, the
        funding dries up, or the product gets buried under ads and paywalls. ROTV can't be acquired,
        shut down, or locked behind a subscription. The community owns it.
      </p>

      <p>
        <strong>Participation.</strong> The same people who maintain trails, lead hikes, and organize
        cleanups can contribute to ROTV. Park districts can submit event feeds. Developers can
        contribute features. The goal is to build the same volunteer stewardship network online that
        already exists on the trails.
      </p>

      <p className="about-closing">The valley belongs to everyone. The map should too.</p>
    </div>
  );
}

function AboutTutorial({ onStartTour }) {
  return (
    <div className="about-tutorial">
      <h2>Learn How ROTV Works</h2>
      <p>
        New here? Take a quick guided tour to learn how to use the interactive map,
        find events, check trail conditions, and discover new places in the valley.
      </p>
      <button className="about-tour-btn" onClick={onStartTour}>
        Take a Tour
      </button>
    </div>
  );
}

function AboutPage({ onStartTour, aboutTab, onTabChange }) {
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
            Send Feedback
          </button>
          <button
            className={`settings-tab-btn about-tab-btn ${aboutTab === 'privacy' ? 'active' : ''}`}
            onClick={() => onTabChange('privacy')}
            tabIndex={aboutTab === 'privacy' ? 0 : -1}
            role="tab"
            aria-selected={aboutTab === 'privacy'}
          >
            Privacy Policy
          </button>
        </nav>
      </div>

      <div className="about-tab-content" role="tabpanel">
        {aboutTab === 'story' && <AboutStory />}
        {aboutTab === 'tutorial' && <AboutTutorial onStartTour={onStartTour} />}
        {aboutTab === 'feedback' && <FeedbackForm inline />}
        {aboutTab === 'privacy' && <PrivacyPolicy inline />}
      </div>
    </div>
  );
}

export default AboutPage;
