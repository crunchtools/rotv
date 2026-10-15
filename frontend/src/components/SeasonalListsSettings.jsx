import React, { useState, useEffect } from 'react';

const ITEM_FIELDS = [
  { key: 'label', label: 'Name on the form' },
  { key: 'miles', label: 'Miles', type: 'number' },
  { key: 'rating', label: 'Difficulty' },
  { key: 'trail_class', label: 'Class' },
  { key: 'trailhead', label: 'Trailhead' },
  { key: 'nav_latitude', label: 'Trailhead latitude', type: 'number' },
  { key: 'nav_longitude', label: 'Trailhead longitude', type: 'number' }
];

async function send(url, method, body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const answer = await res.json().catch(parseError => ({ error: `HTTP ${res.status}: ${parseError.message}` }));
  if (!res.ok) throw new Error(answer.error || `HTTP ${res.status}`);
  return answer;
}

const STATUS_MESSAGES = {
  exists: (year) => `${year} already has a list.`,
  'not-published-yet': (year) => `Summit Metro Parks has not published its ${year} spree yet.`,
  'no-earlier-list': () => 'There is no earlier spree to carry the rules over from.',
  created: (year) => `The ${year} spree is drafted below.`
};

function Report({ report }) {
  if (!report) return null;
  const rows = [
    ['New this year', report.newTrails],
    ['No longer on the spree', report.dropped],
    ['Changed', (report.changed || []).map(c => `${c.label}: ${c.field} ${c.from} → ${c.to}`)],
    ['Needs details', (report.incomplete || []).map(i => `${i.label}: ${i.needs.join(', ')}`)],
    ['Could not be read', report.unparsed],
    ['Still to do', report.todo]
  ].filter(([, list]) => list && list.length);
  return (
    <div className="settings-info-box">
      <div className="info-box-header">From {report.field} in the district&apos;s Hiking Programs layer, based on {report.basedOn}</div>
      {rows.map(([title, list]) => (
        <div key={title}>
          <strong>{title}</strong>
          <ul className="info-list">{list.map(line => <li key={line}>{line}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

function DraftItem({ list, item, onSaved, onError }) {
  const [edits, setEdits] = useState({});
  const value = (key) => (key in edits ? edits[key] : item[key] ?? '');
  const save = async () => {
    try {
      onSaved(await send(`/api/admin/lists/${list.id}/items/${item.id}`, 'PUT', edits));
      setEdits({});
    } catch (err) {
      onError(err.message);
    }
  };
  const remove = async () => {
    try { onSaved(await send(`/api/admin/lists/${list.id}/items/${item.id}`, 'DELETE')); } catch (err) { onError(err.message); }
  };
  return (
    <fieldset className="seasonal-list-item">
      <legend>{item.position}. {item.poi_name}{item.has_section ? ' (part of the trail)' : ''}</legend>
      {ITEM_FIELDS.map(({ key, label, type }) => (
        <label key={key} className="settings-field">
          {label}
          <input type={type || 'text'} step="any" value={value(key)} onChange={(e) => setEdits(prev => ({ ...prev, [key]: e.target.value }))} />
        </label>
      ))}
      <div className="settings-actions">
        <button type="button" className="save-settings-btn" onClick={save} disabled={Object.keys(edits).length === 0}>Save</button>
        <button type="button" className="seasonal-list-remove" onClick={remove}>Remove from the list</button>
      </div>
    </fieldset>
  );
}

function Unmatched({ list, entry, trails, onSaved, onError }) {
  const [name, setName] = useState(entry.candidates?.[0]?.name || '');
  const add = async () => {
    const trail = trails.find(t => t.name === name);
    if (!trail) { onError(`No trail named "${name}" on the map`); return; }
    try {
      onSaved(await send(`/api/admin/lists/${list.id}/items`, 'POST', { poi_id: trail.id, label: entry.districtName, entry: entry.entry }));
    } catch (err) {
      onError(err.message);
    }
  };
  return (
    <div className="seasonal-list-unmatched">
      <p>{entry.entry}</p>
      <label className="settings-field">
        Trail on the map
        <input list="seasonal-list-trails" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" className="save-settings-btn" onClick={add}>Add to the list</button>
    </div>
  );
}

/**
 * Settings › Seasonal Lists (spec 052): each August the coming season's spree
 * is drafted from the district's data; here an admin fills in what it could
 * not, and publishes it. Visitors see nothing until then.
 *
 * @returns {JSX.Element}
 */
export default function SeasonalListsSettings() {
  const [lists, setLists] = useState(null);
  const [trails, setTrails] = useState([]);
  const [message, setMessage] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = async () => {
    try {
      setLists(await send('/api/admin/lists', 'GET'));
    } catch (err) {
      setMessage({ type: 'error', text: `Could not load lists: ${err.message}` });
    }
  };

  useEffect(() => {
    load();
    send('/api/admin/lists/trails', 'GET').then(setTrails).catch(err => {
      setTrails([]);
      setMessage({ type: 'error', text: `Could not load trails for the picker: ${err.message}` });
    });
  }, []);

  const replace = (updated) => setLists(prev => prev.map(list => (list.id === updated.id ? updated : list)));
  const onError = (text) => setMessage({ type: 'error', text });
  const nextYear = lists?.length ? Math.max(...lists.map(l => l.edition)) + 1 : new Date().getFullYear();

  const check = async () => {
    setChecking(true);
    setMessage(null);
    try {
      const result = await send('/api/admin/lists/refresh', 'POST', { edition: nextYear });
      setMessage({ type: result.status === 'created' ? 'success' : 'info', text: STATUS_MESSAGES[result.status]?.(nextYear) || result.status });
      if (result.status === 'created') await load();
    } catch (err) {
      onError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const publish = async (list) => {
    try {
      replace(await send(`/api/admin/lists/${list.id}/publish`, 'POST'));
      setMessage({ type: 'success', text: `The ${list.edition} ${list.name} is published.` });
    } catch (err) {
      onError(err.message);
    }
  };

  if (!lists) return <div className="settings-section"><p>Loading lists...</p></div>;

  return (
    <div className="settings-section seasonal-lists-settings">
      <h3>Seasonal Lists</h3>
      <p className="settings-description">
        Each August the coming Fall Hiking Spree is drafted from Summit Metro Parks&apos; own data. Fill in what it could not match, then publish it.
      </p>
      <div className="settings-actions">
        <button type="button" className="save-settings-btn" onClick={check} disabled={checking}>
          {checking ? 'Checking...' : `Check for the ${nextYear} spree`}
        </button>
      </div>
      {message && <div className={`result-message ${message.type}`}>{message.text}</div>}
      <datalist id="seasonal-list-trails">{trails.map(t => <option key={t.id} value={t.name} />)}</datalist>

      {lists.map(list => (
        <div key={list.id} className="seasonal-list">
          <div className="settings-divider" />
          <h4>{list.edition} {list.name} · {list.status === 'draft' ? 'Draft' : 'Published'}</h4>
          <p className="field-hint">{list.starts_on} to {list.ends_on} · {list.items.length} trails</p>
          {list.status === 'draft' && (
            <>
              <Report report={list.refresh_report} />
              {(list.refresh_report?.unmatched || []).map(entry => (
                <Unmatched key={entry.entry} list={list} entry={entry} trails={trails} onSaved={replace} onError={onError} />
              ))}
              {list.items.map(item => (
                <DraftItem key={item.id} list={list} item={item} onSaved={replace} onError={onError} />
              ))}
              <div className="settings-actions">
                <button type="button" className="save-settings-btn" onClick={() => publish(list)} disabled={list.items.length === 0}>
                  Publish the {list.edition} spree
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
