import React from 'react';
import { useNavigate } from 'react-router-dom';

function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="privacy-policy-page">
      <div className="privacy-policy-content">
        <button className="privacy-back-btn" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')}>
          &larr; Back
        </button>

        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated: May 2026</p>

        <section>
          <h2>The Short Version</h2>
          <p>
            Roots of the Valley is a free, open source community project. We don't run ads.
            We don't sell data. We don't track you. We collect the minimum information needed
            to let you sign in, and that's it.
          </p>
        </section>

        <section>
          <h2>What We Collect</h2>
          <p>When you sign in with Google or Facebook, we receive:</p>
          <ul>
            <li>Your name</li>
            <li>Your email address</li>
            <li>Your profile photo</li>
          </ul>
          <p>
            That's the full list. We don't request access to your contacts, calendar,
            files, or anything else.
          </p>
        </section>

        <section>
          <h2>How We Use It</h2>
          <p>Your account information is used for one purpose: identifying you when you sign in.
            We use your name and photo to show who's logged in. We use your email to
            associate your session with your account. We don't send marketing emails,
            newsletters (unless you explicitly subscribe), or third-party communications.
          </p>
        </section>

        <section>
          <h2>What We Don't Do</h2>
          <ul>
            <li>We don't sell your data. Ever. To anyone.</li>
            <li>We don't run advertisements.</li>
            <li>We don't use third-party analytics or tracking scripts.</li>
            <li>We don't share your information with other organizations.</li>
            <li>We don't build advertising profiles or behavioral models.</li>
          </ul>
          <p>
            ROTV is a community project, not a business. There is no revenue model that
            depends on your data. The plan is to create a non-profit to govern this project
            permanently.
          </p>
        </section>

        <section>
          <h2>Cookies</h2>
          <p>
            We use a single session cookie to keep you logged in. That's it. No tracking
            cookies, no third-party cookies, no cookie consent banners because there's
            nothing to consent to beyond basic session management.
          </p>
        </section>

        <section>
          <h2>Where Your Data Lives</h2>
          <p>
            Your account data is stored in a PostgreSQL database on infrastructure we
            control. We don't use third-party data processors, cloud analytics platforms,
            or customer data platforms. The data sits on our server and nowhere else.
          </p>
        </section>

        <section>
          <h2>Your Rights</h2>
          <ul>
            <li><strong>Delete your account:</strong> Contact us and we'll remove all your data.</li>
            <li><strong>Export your data:</strong> Contact us and we'll provide everything we have on you (it's not much).</li>
            <li><strong>Know what we have:</strong> This page is the complete picture. There are no hidden data stores.</li>
          </ul>
        </section>

        <section>
          <h2>Open Source Transparency</h2>
          <p>
            Don't take our word for it. The entire ROTV codebase is open source under
            the AGPL-3.0 license. You can read exactly how authentication works, what
            we store in the database, and how data flows through the system.
          </p>
          <p>
            <a href="https://github.com/crunchtools/rotv" target="_blank" rel="noopener noreferrer">
              View the source code on GitHub
            </a>
          </p>
        </section>

        <section>
          <h2>Changes to This Policy</h2>
          <p>
            If we ever change this policy, we'll update the date at the top of this page.
            Given that our entire model is "collect nothing, sell nothing," we don't
            anticipate meaningful changes.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions? Open an issue on{' '}
            <a href="https://github.com/crunchtools/rotv/issues" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>{' '}
            or email scott@crunchtools.com.
          </p>
        </section>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
