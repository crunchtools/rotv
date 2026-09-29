import React from 'react';

// Umami's read-only share dashboard (#637), same-origin through the /stats
// proxy, which requires an admin session. The full Umami UI (reports, funnels,
// event property drill-down) needs its own admin login.
const SHARE_URL = '/stats/share/rotv';

function StatsSettings() {
  return (
    <div className="stats-settings">
      <div className="stats-settings-header">
        <p>
          Cookieless, first-party usage analytics. Custom events include tracker use
          (<code>tracker_click</code>, <code>tracker_route_open</code>), POI views, searches and more.
        </p>
        <div className="stats-settings-links">
          <a href={SHARE_URL} target="_blank" rel="noopener noreferrer">Open in new tab</a>
          <a href="/stats/login" target="_blank" rel="noopener noreferrer">Full Umami dashboard</a>
        </div>
      </div>
      <iframe className="stats-settings-frame" src={SHARE_URL} title="Site statistics" />
    </div>
  );
}

export default StatsSettings;
