import React, { useState, useEffect } from 'react';
import PoiSearchSelect from './PoiSearchSelect';
import { FIELD_CONFIGS } from '../hooks/useModeration';

function ContentFormModal({
  mode = 'create',
  contentType = 'news',
  fields,
  setFields,
  item,
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
  const [localFields, setLocalFields] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [localPois, setLocalPois] = useState(pois);

  const activeFields = isEdit ? fields : localFields;
  const activeSetFields = isEdit ? setFields : setLocalFields;

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

  const fieldConfigs = FIELD_CONFIGS[contentType] || [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    for (const fc of fieldConfigs) {
      if (fc.required && !activeFields[fc.key]?.toString().trim()) {
        setError(`${fc.label} is required`);
        return;
      }
    }

    if (isEdit) {
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

  const title = isEdit
    ? `Edit ${contentType === 'news' ? 'News Item' : 'Event'}`
    : `Create ${contentType === 'news' ? 'News Item' : 'Event'}`;

  return (
    <div className="new-content-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="new-content-modal">
        <div className="new-content-header">
          <h3>{title}</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="new-content-form">
          {error && <div className="form-error">{error}</div>}

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
                {item.confidence_score != null && ` · Score: ${(item.confidence_score * 100).toFixed(0)}%`}
              </div>
            </div>
          )}

          {fieldConfigs.map(fc => (
            <div className="form-section" key={fc.key}>
              <label>{fc.label}{fc.required ? ' *' : ''}</label>
              {renderFieldInput(fc)}
            </div>
          ))}

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
              {saving ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save' : `Create ${contentType === 'news' ? 'News' : 'Event'}`)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ContentFormModal;
