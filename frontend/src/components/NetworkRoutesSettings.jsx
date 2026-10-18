import React, { useState, useEffect, useCallback } from 'react';

// Network Routes: which way each scraped site's requests leave the server.
// Backend: backend/services/egressRoutes.js (crawler) and egressAdmin.js (these endpoints).

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const ROUTE_OPTIONS = [
  { value: 'expressvpn', label: 'ExpressVPN' },
  { value: 'direct', label: 'No proxy (server IP)' },
  { value: 'residential', label: 'IPRoyal (residential, paid)' }
];
const ROUTE_LABEL = Object.fromEntries(ROUTE_OPTIONS.map(o => [o.value, o.label]));

const selectStyle = { padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' };
const cellStyle = { padding: '6px 8px', borderBottom: '1px solid #eee', verticalAlign: 'top' };

function when(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString() : '—';
}

async function send(method, path, body) {
  const response = await fetch(`/api/admin/egress${path}`, {
    method, headers: JSON_HEADERS, credentials: 'include',
    ...(body !== undefined && { body: JSON.stringify(body) })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

export default function NetworkRoutesSettings() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newRoute, setNewRoute] = useState('direct');
  const [capDraft, setCapDraft] = useState('');

  const apply = useCallback((nextOverview) => {
    setOverview(nextOverview);
    setCapDraft(String(nextOverview.residentialCap));
  }, []);

  useEffect(() => {
    send('GET', '')
      .then(apply)
      .catch(err => setError(err.message));
  }, [apply]);

  const run = async (action, success) => {
    setBusy(true);
    try {
      apply(await action());
      setMessage({ type: 'success', text: success });
      return true;
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      return false;
    } finally {
      setBusy(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const setRoute = (domain, route) => run(
    () => send('PUT', `/routes/${encodeURIComponent(domain)}`, { route }),
    `${domain} pinned to ${ROUTE_LABEL[route]}`
  );
  const resetRoute = (domain) => run(
    () => send('DELETE', `/routes/${encodeURIComponent(domain)}`),
    `${domain} reset to the default route`
  );
  const addDomain = () => {
    const domain = newDomain.trim();
    if (!domain) return;
    run(() => send('PUT', `/routes/${encodeURIComponent(domain)}`, { route: newRoute }), `${domain} added`)
      .then(saved => { if (saved) setNewDomain(''); });
  };
  const saveSettings = (changes, success) => run(() => send('PUT', '/settings', changes), success);

  if (error) return <div className="ai-config-section"><h4>Network Routes</h4><p style={{ color: '#c62828' }}>{error}</p></div>;
  if (!overview) return <div className="ai-config-section"><h4>Network Routes</h4><p>Loading...</p></div>;

  const residential = overview.usage.residential || { today: 0, last30: 0 };
  const mb = (renders) => Math.round(renders * overview.estimatedMbPerRender);

  return (
    <div className="ai-config-section">
      <h4>Network Routes</h4>
      <p className="settings-description">
        How the crawler reaches each site. When a site blocks a route, the crawler tries the others,
        cheapest first: ExpressVPN, then no proxy, then IPRoyal, and remembers the one that worked (Auto).
        Picking a route for a domain pins it (Manual), which turns failover off for that site.
      </p>

      <div className="config-row">
        <label htmlFor="egress-default">Default route</label>
        <select id="egress-default" style={selectStyle} value={overview.defaultRoute} disabled={busy}
          onChange={e => saveSettings({ defaultRoute: e.target.value }, `Default route set to ${ROUTE_LABEL[e.target.value]}`)}>
          {ROUTE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="config-hint">Used for every site without its own route.</span>
      </div>

      <div className="config-row">
        <label htmlFor="egress-cap">IPRoyal daily cap</label>
        <input id="egress-cap" type="number" min="0" value={capDraft} disabled={busy} style={{ width: '90px' }}
          onChange={e => setCapDraft(e.target.value)} />
        <button className="action-btn secondary" disabled={busy || capDraft === String(overview.residentialCap)}
          onClick={() => saveSettings({ residentialCap: Number(capDraft) }, 'IPRoyal daily cap saved')}>Save</button>
        <span className="config-hint">
          {overview.residentialConfigured ? 'Configured. ' : 'Not configured (RESIDENTIAL_PROXY unset); failover stops at no proxy. '}
          Today {residential.today} of {overview.residentialCap} renders; last 30 days {residential.last30} renders
          (about {mb(residential.last30)} MB).
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginTop: '0.75rem' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={cellStyle}>Domain</th>
            <th style={cellStyle}>Route</th>
            <th style={cellStyle}>Set by</th>
            <th style={cellStyle}>Last OK</th>
            <th style={cellStyle}>Last blocked</th>
            <th style={cellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {overview.routes.length === 0 && (
            <tr><td style={cellStyle} colSpan={6}>Every site uses the default route.</td></tr>
          )}
          {overview.routes.map(r => (
            <tr key={r.domain}>
              <td style={cellStyle}>{r.domain}</td>
              <td style={cellStyle}>
                <select aria-label={`Route for ${r.domain}`} style={selectStyle} value={r.route} disabled={busy}
                  onChange={e => setRoute(r.domain, e.target.value)}>
                  {ROUTE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </td>
              <td style={cellStyle}>{r.source === 'manual' ? 'Manual' : 'Auto'}</td>
              <td style={cellStyle}>{when(r.lastOkAt)}</td>
              <td style={{ ...cellStyle, color: r.lastBlockedAt ? '#c62828' : undefined }}>
                {when(r.lastBlockedAt)}
                {r.lastBlockedAt && r.lastError && <div style={{ fontSize: '0.8rem' }}>{r.lastError}</div>}
              </td>
              <td style={cellStyle}>
                <button className="sync-btn-small" disabled={busy} onClick={() => resetRoute(r.domain)}>Reset</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <input type="text" placeholder="example.org" value={newDomain} disabled={busy} aria-label="New domain"
          onChange={e => setNewDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDomain()} />
        <select aria-label="Route for new domain" style={selectStyle} value={newRoute} disabled={busy}
          onChange={e => setNewRoute(e.target.value)}>
          {ROUTE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="action-btn secondary" disabled={busy || !newDomain.trim()} onClick={addDomain}>Add domain</button>
      </div>

      {message && (
        <p style={{ color: message.type === 'error' ? '#c62828' : '#2e7d32', marginTop: '0.5rem' }}>{message.text}</p>
      )}
    </div>
  );
}
