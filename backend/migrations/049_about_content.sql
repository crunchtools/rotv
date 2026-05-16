-- Seed About page content into admin_settings as markdown.
-- Converts the hardcoded JSX content from AboutPage.jsx and PrivacyPolicy.jsx
-- so admins can edit it without code changes.

INSERT INTO admin_settings (key, value) VALUES
('about_story_md', '## One Map for Everything Happening in the Cuyahoga Valley

The Cuyahoga Valley has over 300 parks, trailheads, preserves, and landmarks, but the information about them is scattered across dozens of websites run by the National Park Service, Cleveland Metroparks, Summit Metro Parks, and countless other organizations. A mountain biker checking whether trails are rideable might need to check TrailForks, Twitter, and two different park district websites. A family looking for weekend activities doesn''t have time to visit dozens of event calendars.

The result: people stick to what they already know and miss 95% of what the valley offers.

**Roots of the Valley fixes that.** We traverse the deepest corners of the web to aggregate news, events, and social signals that traditional search engines miss, distilling them into one seamless, interactive map. Every point of interest shows its latest news, upcoming events, and current trail status. Open one page and immediately see what''s open, what''s happening this weekend, and what''s worth discovering for the first time.

---

## Built in the Open

The Cuyahoga Valley is public land, maintained through shared stewardship by rangers, volunteers, trail crews, and the people who use it every day. Roots of the Valley works the same way.

The entire project, code, data, and infrastructure, is open source. Anyone can see how it works, suggest improvements, or adapt it for their own region.

**Transparency.** When ROTV says a trail is closed, you can trace exactly where that information came from. There''s no opaque algorithm deciding what you see. The collection sources are public, the moderation queue is human-reviewed, and the codebase is on [GitHub](https://github.com/crunchtools/rotv).

**Durability.** Free services disappear all the time, the company pivots, the funding dries up, or the product gets buried under ads and paywalls. ROTV can''t be acquired, shut down, or locked behind a subscription. The community owns it.

**Participation.** The same people who maintain trails, lead hikes, and organize cleanups can contribute to ROTV. Park districts can submit event feeds. Developers can contribute features. The goal is to build the same volunteer stewardship network online that already exists on the trails.

*The valley belongs to everyone. The map should too.*')
ON CONFLICT (key) DO NOTHING;

INSERT INTO admin_settings (key, value) VALUES
('about_tutorial_md', '## Learn How ROTV Works

New here? Take a quick guided tour to learn how to use the interactive map, find events, check trail conditions, and discover new places in the valley.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO admin_settings (key, value) VALUES
('about_privacy_md', '# Privacy Policy

*Last updated: May 2026*

## The Short Version

Roots of the Valley is a free, open source community project. We don''t run ads. We don''t sell data. We don''t track you. We collect the minimum information needed to let you sign in, and that''s it.

## What We Collect

When you sign in with Google or Facebook, we receive:

- Your name
- Your email address
- Your profile photo

That''s the full list. We don''t request access to your contacts, calendar, files, or anything else.

## How We Use It

Your account information is used for one purpose: identifying you when you sign in. We use your name and photo to show who''s logged in. We use your email to associate your session with your account. We don''t send marketing emails, newsletters (unless you explicitly subscribe), or third-party communications.

## What We Don''t Do

- We don''t sell your data. Ever. To anyone.
- We don''t run advertisements.
- We don''t use third-party analytics or tracking scripts.
- We don''t share your information with other organizations.
- We don''t build advertising profiles or behavioral models.

ROTV is a community project, not a business. There is no revenue model that depends on your data. The plan is to create a non-profit to govern this project permanently.

## Cookies

We use a single session cookie to keep you logged in. That''s it. No tracking cookies, no third-party cookies, no cookie consent banners because there''s nothing to consent to beyond basic session management.

## Where Your Data Lives

Your account data is stored in a PostgreSQL database on infrastructure we control. We don''t use third-party data processors, cloud analytics platforms, or customer data platforms. The data sits on our server and nowhere else.

## Your Rights

- **Delete your account:** Contact us and we''ll remove all your data.
- **Export your data:** Contact us and we''ll provide everything we have on you (it''s not much).
- **Know what we have:** This page is the complete picture. There are no hidden data stores.

## Photos You Upload

When you submit a photo or video to a point of interest, you retain full ownership and all rights to that content. By uploading, you grant ROTV a non-exclusive license to display it on the site, in the weekly newsletter, and on ROTV social media accounts — nothing more. We won''t sell your photos or videos, use them in unrelated advertising, or sub-license them to third parties.

All uploads go through moderation before they appear on the site. If you want something removed, contact us and we''ll take it down.

## Open Source Transparency

Don''t take our word for it. The entire ROTV codebase is open source under the AGPL-3.0 license. You can read exactly how authentication works, what we store in the database, and how data flows through the system.

[View the source code on GitHub](https://github.com/crunchtools/rotv)

## Changes to This Policy

If we ever change this policy, we''ll update the date at the top of this page. Given that our entire model is "collect nothing, sell nothing," we don''t anticipate meaningful changes.

## Contact

Questions? Open an issue on [GitHub](https://github.com/crunchtools/rotv/issues) or email admin@rootsofthevalley.org.')
ON CONFLICT (key) DO NOTHING;
