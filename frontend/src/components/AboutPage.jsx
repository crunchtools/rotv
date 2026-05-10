import React from 'react';

function AboutPage({ onStartTour }) {
  return (
    <main className="about-page">
      <div className="about-content">
        <h2>About Roots of The Valley</h2>
        <p className="about-tagline">
          An interactive map exploring the history, nature, and community of Cuyahoga Valley National Park.
        </p>

        <section className="about-section">
          <h3>What is ROTV?</h3>
          <p>
            Roots of The Valley is a discovery engine for Cuyahoga Valley National Park and the surrounding area.
            We aggregate news, events, trail conditions, and historical information from dozens of local sources
            so you can find what&apos;s happening without searching everywhere yourself.
          </p>
        </section>

        <section className="about-section">
          <h3>Features</h3>
          <ul className="about-features-list">
            <li>
              <strong>Interactive Map</strong> &mdash; Browse 200+ points of interest including trails, historic sites, waterfalls, and more
            </li>
            <li>
              <strong>Dynamic Results</strong> &mdash; The results list updates as you zoom and pan the map
            </li>
            <li>
              <strong>Park News</strong> &mdash; AI-curated news from local sources, filtered to your map view
            </li>
            <li>
              <strong>Events</strong> &mdash; Concerts, hikes, programs, and community events happening near you
            </li>
            <li>
              <strong>POI & Boundary Overlays</strong> &mdash; Toggle point of interest types and park boundaries
            </li>
            <li>
              <strong>Place Details</strong> &mdash; Click any POI for Info, News, Events, History, and Associations
            </li>
            <li>
              <strong>Newsletter</strong> &mdash; Sign up for a weekly digest of news and events (requires login)
            </li>
          </ul>
        </section>

        <section className="about-section">
          <h3>Get Started</h3>
          <p>
            New here? Take a quick guided tour to learn how ROTV works.
          </p>
          <button className="about-tour-btn" onClick={onStartTour}>
            Take a Tour
          </button>
        </section>

        <section className="about-section about-credits">
          <h3>Credits</h3>
          <p>
            Built by <a href="https://crunchtools.com" target="_blank" rel="noopener noreferrer">Crunchtools</a>.
            Feedback welcome &mdash; use the Send Feedback option in the menu.
          </p>
        </section>
      </div>
    </main>
  );
}

export default AboutPage;
