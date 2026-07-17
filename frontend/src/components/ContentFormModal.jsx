import React, { useState, useEffect } from 'react';
import PoiSearchSelect from './PoiSearchSelect';
import { FIELD_CONFIGS } from '../hooks/useModeration';

function ContentFormModal({
  mode = 'create',
  contentType = 'news',
  fields,
  setFields,
  item,
  seriesEdit,
  pois = [],
  itemUrls = [],
  newUrlInput = '',
  setNewUrlInput,
  addingUrl = false,
  onAddUrl,
  onRemoveUrl,
  onSave,
  onCreate,
  onClose
}) {
  const isEdit = mode === 'edit';
  const isSeriesEdit = !!seriesEdit;
  const [localFields, setLocalFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [localPois, setLocalPois] = useState(pois);

  // Recurring-event authoring (#436): a "Repeats" dropdown that swaps the one-off date
  // fields for a recurrence rule + season + venue, posting to the series API. Also reused
  // to EDIT an existing series (pre-filled, PUT).
  const [repeatInterval, setRepeatInterval] = useState(0); // 0 = does not repeat (one-time)
  const [recur, setRecur] = useState({
    byday: [], season_start: '', season_end: '',
    time_start: '', time_end: '', venue_poi_id: '', exdates: ''
  });
  const showRecurring = isSeriesEdit || (!isEdit && contentType === 'event' && repeatInterval > 0);
  const WEEKDAYS = [
    { code: 'SU', label: 'Sun' }, { code: 'MO', label: 'Mon' }, { code: 'TU', label: 'Tue' },
    { code: 'WE', label: 'Wed' }, { code: 'TH', label: 'Thu' }, { code: 'FR', label: 'Fri' },
    { code: 'SA', label: 'Sat' }
  ];
  const toggleDay = (code) => setRecur(prev => ({
    ...prev,
    byday: prev.byday.includes(code) ? prev.byday.filter(d => d !== code) : [...prev.byday, code]
  }));

  const activeFields = isEdit ? fields : localFields;
  const activeSetFields = isEdit ? setFields : setLocalFields;

  // Pre-fill from an existing series when editing one.
  useEffect(() => {
    if (!seriesEdit) return;
    setLocalFields({
      title: seriesEdit.title || '',
      description: seriesEdit.description || '',
      event_type: seriesEdit.event_type || '',
      location_details: seriesEdit.location_details || '',
      source_url: seriesEdit.source_url || '',
      poi_id: seriesEdit.poi_id || ''
    });
    setRepeatInterval(seriesEdit.interval || 1);
    setRecur({
      byday: seriesEdit.byday || [],
      season_start: String(seriesEdit.season_start || '').slice(0, 10),
      season_end: String(seriesEdit.season_end || '').slice(0, 10),
      time_start: String(seriesEdit.time_start || '').slice(0, 5),
      time_end: String(seriesEdit.time_end || '').slice(0, 5),
      venue_poi_id: seriesEdit.venue_poi_id || '',
      exdates: (seriesEdit.exdates || []).map(d => String(d).slice(0, 10)).join(', ')
    });
  }, [seriesEdit]);

  useEffect(() => {
    if (pois.length > 0) {
      setLocalPois(pois);
      return;
    }
    fetch('/api/pois', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setLocalPois(Array.isArray(data) ? data.filter(p => !p.deleted).sort((a, b) => a.name.localeCompare(b.name)) : []))
      .catch(() => setLocalPois([]));
  }, [pois]);

  const allFieldConfigs = FIELD_CONFIGS[contentType] || [];
  // In recurring mode the one-off date fields are replaced by the recurrence/season fields.
  const fieldConfigs = showRecurring
    ? allFieldConfigs.filter(fc => !['start_date', 'end_date', 'publication_date'].includes(fc.key))
    : allFieldConfigs;

  const submitRecurringSeries = async () => {
    if (!activeFields.poi_id) { setError('Organizer POI is required'); return; }
    if (recur.byday.length === 0) { setError('Pick at least one day of the week'); return; }
    if (!recur.season_start || !recur.season_end) { setError('Season start and end dates are required'); return; }
    setSaving(true);
    try {
      const response = await fetch(
        isSeriesEdit ? `/api/admin/event-series/${seriesEdit.id}` : '/api/admin/event-series', {
        method: isSeriesEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          poi_id: parseInt(activeFields.poi_id),
          venue_poi_id: recur.venue_poi_id ? parseInt(recur.venue_poi_id) : null,
          title: activeFields.title,
          description: activeFields.description || null,
          event_type: activeFields.event_type || null,
          location_details: activeFields.location_details || null,
          source_url: activeFields.source_url || null,
          freq: 'WEEKLY',
          interval: repeatInterval,
          byday: recur.byday,
          season_start: recur.season_start,
          season_end: recur.season_end,
          time_start: recur.time_start || null,
          time_end: recur.time_end || null,
          exdates: recur.exdates.split(',').map(s => s.trim()).filter(Boolean)
        })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save recurring event');
      }
      if (onCreate) onCreate();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    for (const fc of fieldConfigs) {
      if (fc.required && !activeFields[fc.key]?.toString().trim()) {
        setError(`${fc.label} is required`);
        return;
      }
    }

    if (showRecurring) {
      submitRecurringSeries();
    } else if (isEdit) {
      onSave();
    } else {
      if (!activeFields.poi_id) {
        setError('POI is required');
        return;
      }
      setSaving(true);
      try {
        const endpoint = contentType === 'news' ? '/api/admin/news' : '/api/admin/events';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...activeFields,
            poi_id: parseInt(activeFields.poi_id),
            publication_date: activeFields.publication_date || null
          })
        });
        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || `Failed to create ${contentType}`);
        }
        if (onCreate) onCreate();
        onClose();
      } catch (err) {
        setError(err.message);
      } finally {
        setSaving(false);
      }
    }
  };

  const renderFieldInput = (fc) => {
    const val = activeFields[fc.key] || '';
    const onChange = (v) => activeSetFields(prev => ({ ...prev, [fc.key]: v }));

    if (fc.type === 'textarea') {
      return <textarea value={val} onChange={e => onChange(e.target.value)}
        rows={3} placeholder={fc.label} />;
    }
    if (fc.type === 'select') {
      return (
        <select value={val} onChange={e => onChange(e.target.value)}>
          <option value="">-- Select --</option>
          {fc.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (fc.type === 'poi') {
      return (
        <PoiSearchSelect
          pois={localPois}
          value={val}
          onChange={(id) => onChange(id || '')}
          placeholder="Search POIs..."
        />
      );
    }
    const lang = fc.type === 'date' ? 'en-US' : undefined;
    return <input type={fc.type || 'text'} value={val} onChange={e => onChange(e.target.value)}
      placeholder={fc.label} required={fc.required} lang={lang} />;
  };

  const title = isSeriesEdit
    ? 'Edit Recurring Event'
    : isEdit
    ? `Edit ${contentType === 'news' ? 'News Item' : 'Event'}`
    : showRecurring
    ? 'Create Recurring Event'
    : `Create ${contentType === 'news' ? 'News Item' : 'Event'}`;

  return (
    <div className="new-content-overlay">
      <div className="new-content-modal">
        <div className="new-content-header">
          <h3>{title}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="new-content-form">
          {error && <div className="form-error">{error}</div>}

          {((!isEdit && contentType === 'event') || isSeriesEdit) && (
            <div className="form-section">
              <label>Repeats</label>
              <select value={repeatInterval} onChange={e => setRepeatInterval(parseInt(e.target.value))}>
                {!isSeriesEdit && <option value={0}>Does not repeat (one-time)</option>}
                <option value={1}>Weekly</option>
                <option value={2}>Every 2 weeks</option>
                <option value={3}>Every 3 weeks</option>
                <option value={4}>Every 4 weeks</option>
              </select>
            </div>
          )}

          {isEdit && item && (item.ai_reasoning || item.moderation_status) && (
            <div className="form-ai-info">
              {item.ai_reasoning && (
                <div className="form-ai-reasoning">
                  <strong>AI Analysis:</strong> {item.ai_reasoning}
                </div>
              )}
              <div className="form-ai-status">
                Status: {item.moderation_status === 'auto_approved' ? 'Auto-approved by AI' :
                  item.moderation_status === 'published' ? 'Approved by human' :
                  item.moderation_status}
              </div>
            </div>
          )}

          {fieldConfigs.map(fc => (
            <div className="form-section" key={fc.key}>
              <label>{fc.key === 'poi_id' && showRecurring ? 'Organizer POI' : fc.label}{fc.required ? ' *' : ''}</label>
              {renderFieldInput(fc)}
            </div>
          ))}

          {showRecurring && (
            <>
              <div className="form-section">
                <label>Venue (where it's held)</label>
                <PoiSearchSelect
                  pois={localPois}
                  value={recur.venue_poi_id}
                  onChange={(id) => setRecur(prev => ({ ...prev, venue_poi_id: id || '' }))}
                  placeholder="Search venue POIs (optional)..."
                />
              </div>
              <div className="form-section">
                <label>On days *</label>
                <div className="recur-weekdays">
                  {WEEKDAYS.map(d => (
                    <button
                      type="button"
                      key={d.code}
                      className={`recur-day ${recur.byday.includes(d.code) ? 'active' : ''}`}
                      onClick={() => toggleDay(d.code)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-section form-row-2">
                <div>
                  <label>Season start *</label>
                  <input type="date" value={recur.season_start} onChange={e => setRecur(prev => ({ ...prev, season_start: e.target.value }))} />
                </div>
                <div>
                  <label>Season end *</label>
                  <input type="date" value={recur.season_end} onChange={e => setRecur(prev => ({ ...prev, season_end: e.target.value }))} />
                </div>
              </div>
              <div className="form-section form-row-2">
                <div>
                  <label>Start time</label>
                  <input type="time" value={recur.time_start} onChange={e => setRecur(prev => ({ ...prev, time_start: e.target.value }))} />
                </div>
                <div>
                  <label>End time</label>
                  <input type="time" value={recur.time_end} onChange={e => setRecur(prev => ({ ...prev, time_end: e.target.value }))} />
                </div>
              </div>
              <div className="form-section">
                <label>Skip dates (optional)</label>
                <input
                  type="text"
                  value={recur.exdates}
                  onChange={e => setRecur(prev => ({ ...prev, exdates: e.target.value }))}
                  placeholder="Comma-separated, e.g. 2026-11-28, 2026-12-26"
                />
              </div>
            </>
          )}

          {isEdit && contentType !== 'photo' && (
            <div className="form-section">
              <label>Additional URLs</label>
              <div className="form-urls-list">
                {itemUrls.map(u => (
                  <div key={u.id} className="form-url-item">
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className="form-url-link">
                      {u.url}
                    </a>
                    {u.source_name && <span className="form-url-source">({u.source_name})</span>}
                    <button type="button" onClick={() => onRemoveUrl(contentType, item.id, u.id)}
                      className="form-url-remove" title="Remove URL">x</button>
                  </div>
                ))}
                <div className="form-url-add">
                  <input type="text" value={newUrlInput} onChange={e => setNewUrlInput(e.target.value)}
                    placeholder="Add another source URL..."
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddUrl(contentType, item.id); }}} />
                  <button type="button" onClick={() => onAddUrl(contentType, item.id)}
                    disabled={addingUrl || !newUrlInput?.trim()}
                    className="form-url-add-btn">
                    {addingUrl ? 'Adding...' : 'Add URL'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="form-buttons">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="save-btn" disabled={saving}>
              {saving
                ? ((isEdit || isSeriesEdit) ? 'Saving...' : 'Creating...')
                : isSeriesEdit ? 'Save Recurring Event'
                : isEdit ? 'Save'
                : showRecurring ? 'Create Recurring Event'
                : `Create ${contentType === 'news' ? 'News' : 'Event'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ContentFormModal;
