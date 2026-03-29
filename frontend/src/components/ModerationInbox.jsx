import React, { useState, useEffect, useCallback } from 'react';

const FIELD_CONFIGS = {
  news: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'source_url', label: 'Source URL', type: 'text' },
    { key: 'source_name', label: 'Source Name', type: 'text' },
    { key: 'news_type', label: 'Type', type: 'select', options: ['general', 'closure', 'seasonal', 'maintenance', 'wildlife'] },
    { key: 'publication_date', label: 'Publication Date', type: 'date' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
  ],
  event: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'start_date', label: 'Start Date/Time', type: 'datetime-local', required: true },
    { key: 'end_date', label: 'End Date/Time', type: 'datetime-local' },
    { key: 'event_type', label: 'Event Type', type: 'text' },
    { key: 'location_details', label: 'Location Details', type: 'text' },
    { key: 'source_url', label: 'Source URL', type: 'text' },
    { key: 'publication_date', label: 'Publication Date', type: 'date' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
  ],
  photo: [
    { key: 'caption', label: 'Caption', type: 'textarea' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
  ]
};

function ModerationInbox() {
  const [queue, setQueue] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [expandedItem, setExpandedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [notification, setNotification] = useState(null);
  const [creating, setCreating] = useState(null); // 'news', 'event', 'photo', or null
  const [createFields, setCreateFields] = useState({});
  const [pois, setPois] = useState([]);
  const [sourceFilter, setSourceFilter] = useState(null);
  const [researchingItem, setResearchingItem] = useState(null);
  const LIMIT = 20;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT, status: statusFilter });
      if (filter) params.set('type', filter);
      if (sourceFilter) params.set('source', sourceFilter);
      const response = await fetch(`/api/admin/moderation/queue?${params}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setQueue(data.items);
        setTotal(data.total);
      }
    } catch (err) {
      console.error('Error fetching moderation queue:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filter, statusFilter, sourceFilter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    fetch('/api/pois', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setPois(Array.isArray(data) ? data : []))
      .catch(() => setPois([]));
  }, []);

  const notify = (type, message) => setNotification({ type, message });

  const handleApprove = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) { notify('success', `${type} #${id} approved`); fetchQueue(); }
    } catch (err) { notify('error', err.message); }
  };

  const handleReject = async (type, id) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      const response = await fetch('/api/admin/moderation/reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id, reason: reason || '' })
      });
      if (response.ok) { notify('success', `${type} #${id} rejected`); fetchQueue(); }
    } catch (err) { notify('error', err.message); }
  };

  const handleBulkApprove = async () => {
    if (selectedItems.size === 0) return;
    const items = Array.from(selectedItems).map(key => {
      const [type, id] = key.split(':');
      return { type, id: parseInt(id) };
    });
    try {
      const response = await fetch('/api/admin/moderation/bulk-approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ items })
      });
      if (response.ok) {
        const data = await response.json();
        notify('success', `${data.approved} items approved`);
        setSelectedItems(new Set());
        fetchQueue();
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleRequeue = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/requeue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) { notify('success', `${type} #${id} requeued`); fetchQueue(); }
    } catch (err) { notify('error', err.message); }
  };

  const handleResearch = async (type, id) => {
    const itemKey = `${type}:${id}`;
    setResearchingItem(itemKey);
    try {
      const response = await fetch('/api/admin/moderation/research', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.source_url_updated) {
          notify('success', `${type} #${id} — URL fixed: ${data.new_url}`);
        } else {
          notify('success', `${type} #${id} — no better URL found, requeued`);
        }
        fetchQueue();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Research failed');
      }
    } catch (err) { notify('error', err.message); }
    finally { setResearchingItem(null); }
  };

  const startEditing = async (item) => {
    const itemKey = `${item.content_type}:${item.id}`;
    try {
      const response = await fetch(`/api/admin/moderation/item/${item.content_type}/${item.id}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const detail = await response.json();
        const fields = {};
        const fieldConfigs = FIELD_CONFIGS[item.content_type] || [];
        for (const fc of fieldConfigs) {
          if (fc.type === 'datetime-local' && detail[fc.key]) {
            fields[fc.key] = new Date(detail[fc.key]).toISOString().slice(0, 16);
          } else if (fc.type === 'date' && detail[fc.key]) {
            fields[fc.key] = new Date(detail[fc.key]).toISOString().slice(0, 10);
          } else {
            fields[fc.key] = detail[fc.key] || '';
          }
        }
        setEditFields(fields);
        setEditingItem(itemKey);
      }
    } catch (err) {
      notify('error', 'Failed to load item details');
    }
  };

  const handleEditPublish = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/edit-publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id, edits: editFields })
      });
      if (response.ok) {
        notify('success', `${type} #${id} edited and published`);
        setEditingItem(null);
        setEditFields({});
        fetchQueue();
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleCreate = async () => {
    if (!creating) return;
    try {
      const response = await fetch('/api/admin/moderation/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type: creating, fields: createFields })
      });
      if (response.ok) {
        const data = await response.json();
        notify('success', `Created ${creating} #${data.id}`);
        setCreating(null);
        setCreateFields({});
        fetchQueue();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Create failed');
      }
    } catch (err) { notify('error', err.message); }
  };

  const toggleSelect = (type, id) => {
    const key = `${type}:${id}`;
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedItems.size === queue.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(queue.map(item => `${item.content_type}:${item.id}`)));
    }
  };

  const getConfidenceColor = (score) => {
    if (score === null || score === undefined) return '#999';
    if (score < 0.5) return '#f44336';
    if (score < 0.9) return '#ff9800';
    return '#4caf50';
  };

  const getTypeBadgeColor = (type) => {
    switch (type) {
      case 'news': return '#2196f3';
      case 'event': return '#9c27b0';
      case 'photo': return '#4caf50';
      default: return '#757575';
    }
  };

  const getSourceBadge = (source) => {
    switch (source) {
      case 'ai': return { label: 'AI', color: '#ff9800' };
      case 'human': return { label: 'Human', color: '#607d8b' };
      case 'newsletter': return { label: 'Newsletter', color: '#00897b' };
      case 'feed': return { label: 'Feed', color: '#5c6bc0' };
      case 'api': return { label: 'API', color: '#8d6e63' };
      case 'community': return { label: 'Community', color: '#26a69a' };
      default: return null;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'published': return { label: 'Approved', color: '#4caf50' };
      case 'auto_approved': return { label: 'Auto', color: '#2196f3' };
      case 'rejected': return { label: 'Rejected', color: '#f44336' };
      case 'pending': return { label: 'Pending', color: '#ff9800' };
      default: return { label: status, color: '#757575' };
    }
  };

  const getDateConfidenceBadge = (confidence) => {
    switch (confidence) {
      case 'exact': return { label: 'Exact', color: '#4caf50' };
      case 'estimated': return { label: 'Est.', color: '#ff9800' };
      case 'unknown': return { label: 'No Date', color: '#f44336' };
      default: return null;
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const formatPubDate = (dateStr) => {
    if (!dateStr) return '';
    const str = String(dateStr);
    const d = str.includes('T') ? new Date(str) : new Date(str + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  };

  const isPending = statusFilter === 'pending';
  const totalPages = Math.ceil(total / LIMIT);

  const pillActive = (active) => ({
    padding: '5px 14px',
    borderRadius: '16px',
    border: 'none',
    backgroundColor: active ? '#333' : '#f0f0f0',
    color: active ? 'white' : '#555',
    cursor: 'pointer',
    fontSize: '0.82rem',
    fontWeight: active ? '600' : '400',
    transition: 'all 0.15s ease'
  });

  const renderFieldInput = (fc, values, setValues) => {
    const val = values[fc.key] || '';
    const onChange = (v) => setValues({ ...values, [fc.key]: v });

    if (fc.type === 'textarea') {
      return (
        <textarea value={val} onChange={e => onChange(e.target.value)}
          rows={3} style={inputStyle} placeholder={fc.label} />
      );
    }
    if (fc.type === 'select') {
      return (
        <select value={val} onChange={e => onChange(e.target.value)} style={inputStyle}>
          <option value="">-- Select --</option>
          {fc.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (fc.type === 'poi') {
      return (
        <select value={val} onChange={e => onChange(parseInt(e.target.value) || '')} style={inputStyle}>
          <option value="">-- Select POI --</option>
          {pois.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      );
    }
    return (
      <input type={fc.type || 'text'} value={val} onChange={e => onChange(e.target.value)}
        style={inputStyle} placeholder={fc.label} required={fc.required} />
    );
  };

  const inputStyle = {
    padding: '6px 10px', borderRadius: '6px', border: '1px solid #d0d0d0',
    fontSize: '0.85rem', width: '100%', boxSizing: 'border-box'
  };

  const btnStyle = (bg, color = 'white', border = 'none') => ({
    padding: '5px 12px', border, borderRadius: '6px',
    backgroundColor: bg, color, cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500'
  });

  return (
    <div className="moderation-inbox">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Moderation Queue</h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{
            backgroundColor: total > 0 && isPending ? '#f44336' : '#888',
            color: 'white', padding: '2px 10px', borderRadius: '12px',
            fontSize: '0.82rem', fontWeight: 'bold'
          }}>
            {total}
          </span>
          {/* Purge rejected button */}
          {statusFilter === 'rejected' && total > 0 && (
            <button
              onClick={async () => {
                const typeLabel = filter ? filter + 's' : 'items';
                if (!window.confirm(`Delete all ${total} rejected ${typeLabel}? This cannot be undone.`)) return;
                try {
                  const response = await fetch('/api/admin/moderation/purge-rejected', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', body: JSON.stringify({ type: filter || null })
                  });
                  if (response.ok) {
                    const data = await response.json();
                    notify('success', `Purged ${data.deleted} rejected items`);
                    fetchQueue();
                  }
                } catch (err) { notify('error', err.message); }
              }}
              style={btnStyle('#b71c1c')}
            >
              Purge Rejected
            </button>
          )}
          {/* Create button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setCreating(creating ? null : 'news')}
              style={btnStyle(creating ? '#333' : '#4caf50')}
            >
              + Create
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar — single row */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Status filters */}
        {[
          { label: 'All', value: 'all' },
          { label: 'Pending', value: 'pending' },
          { label: 'Approved', value: 'approved' },
          { label: 'Auto', value: 'auto_approved' },
          { label: 'Rejected', value: 'rejected' },
        ].map(f => (
          <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(1); setSelectedItems(new Set()); }}
            style={pillActive(statusFilter === f.value)}>
            {f.label}
          </button>
        ))}

        <span style={{ color: '#ccc', fontSize: '1.1rem', margin: '0 2px' }}>|</span>

        {/* Type filters */}
        {[
          { label: 'All Types', value: null },
          { label: 'News', value: 'news' },
          { label: 'Events', value: 'event' },
          { label: 'Photos', value: 'photo' },
        ].map(f => (
          <button key={f.label} onClick={() => { setFilter(f.value); setPage(1); }}
            style={pillActive(filter === f.value)}>
            {f.label}
          </button>
        ))}

        <span style={{ color: '#ccc', fontSize: '1.1rem', margin: '0 2px' }}>|</span>

        {/* Source filters */}
        {[
          { label: 'All Sources', value: null },
          { label: 'AI', value: 'ai' },
          { label: 'Human', value: 'human' },
          { label: 'Newsletter', value: 'newsletter' },
        ].map(f => (
          <button key={`src-${f.label}`} onClick={() => { setSourceFilter(f.value); setPage(1); }}
            style={pillActive(sourceFilter === f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Create form */}
      {creating && (
        <div style={{
          border: '2px solid #4caf50', borderRadius: '8px', padding: '16px',
          marginBottom: '12px', backgroundColor: '#f9fff9'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0 }}>Create New Content</h4>
            <button onClick={() => { setCreating(null); setCreateFields({}); }}
              style={{ ...btnStyle('transparent', '#999', '1px solid #ccc'), fontSize: '0.75rem' }}>Cancel</button>
          </div>

          {/* Type selector for create */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {['news', 'event', 'photo'].map(t => (
              <button key={t} onClick={() => { setCreating(t); setCreateFields({}); }}
                style={pillActive(creating === t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(FIELD_CONFIGS[creating] || []).map(fc => (
              <div key={fc.key}>
                <label style={{ fontSize: '0.78rem', color: '#666', fontWeight: '500', marginBottom: '2px', display: 'block' }}>
                  {fc.label}{fc.required ? ' *' : ''}
                </label>
                {renderFieldInput(fc, createFields, setCreateFields)}
              </div>
            ))}
          </div>

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button onClick={handleCreate} style={btnStyle('#4caf50')}>Create & Publish</button>
            <button onClick={() => { setCreating(null); setCreateFields({}); }}
              style={btnStyle('transparent', '#666', '1px solid #ccc')}>Cancel</button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {isPending && queue.length > 0 && (
        <div style={{
          display: 'flex', gap: '10px', alignItems: 'center',
          marginBottom: '10px', padding: '6px 12px',
          backgroundColor: '#f5f5f5', borderRadius: '6px', fontSize: '0.85rem'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedItems.size === queue.length && queue.length > 0} onChange={selectAll} />
            Select All
          </label>
          <button onClick={handleBulkApprove} disabled={selectedItems.size === 0}
            style={{ ...btnStyle(selectedItems.size > 0 ? '#4caf50' : '#ccc'), padding: '3px 10px' }}>
            Approve Selected ({selectedItems.size})
          </button>
        </div>
      )}

      {/* Queue items */}
      {loading ? (
        <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Loading...</p>
      ) : queue.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>
          {isPending ? 'No pending items.' : `No ${statusFilter} items found.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {queue.map(item => {
            const itemKey = `${item.content_type}:${item.id}`;
            const isExpanded = expandedItem === itemKey;
            const isEditing = editingItem === itemKey;
            const statusBadge = getStatusBadge(item.moderation_status);

            return (
              <div key={itemKey} style={{
                border: '1px solid #e0e0e0', borderRadius: '8px', padding: '10px 12px',
                backgroundColor: selectedItems.has(itemKey) ? '#e3f2fd' : 'white',
                transition: 'background 0.15s'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  {isPending && (
                    <input type="checkbox" checked={selectedItems.has(itemKey)}
                      onChange={() => toggleSelect(item.content_type, item.id)}
                      style={{ marginTop: '4px' }} />
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Header row: badges + title + score */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{
                        backgroundColor: getTypeBadgeColor(item.content_type),
                        color: 'white', padding: '1px 8px', borderRadius: '10px',
                        fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase'
                      }}>
                        {item.content_type}
                      </span>

                      {item.content_source && getSourceBadge(item.content_source) && (
                        <span style={{
                          backgroundColor: getSourceBadge(item.content_source).color,
                          color: 'white', padding: '1px 8px', borderRadius: '10px',
                          fontSize: '0.72rem', fontWeight: 'bold'
                        }}>
                          {getSourceBadge(item.content_source).label}
                        </span>
                      )}

                      {!isPending && (
                        <span style={{
                          backgroundColor: statusBadge.color, color: 'white',
                          padding: '1px 8px', borderRadius: '10px',
                          fontSize: '0.72rem', fontWeight: 'bold'
                        }}>
                          {statusBadge.label}
                        </span>
                      )}

                      <span style={{ fontWeight: 'bold', fontSize: '0.92rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isExpanded ? 'normal' : 'nowrap' }}>
                        {item.title || '(untitled)'}
                      </span>

                      {item.confidence_score !== null && item.confidence_score !== undefined && (
                        <span style={{
                          color: getConfidenceColor(item.confidence_score),
                          fontWeight: 'bold', fontSize: '0.82rem', flexShrink: 0
                        }}>
                          {(item.confidence_score * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    {item.description && (
                      <p style={{
                        margin: '2px 0', fontSize: '0.83rem', color: '#555',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: isExpanded ? 'unset' : 2,
                        WebkitBoxOrient: 'vertical'
                      }}>
                        {item.description}
                      </p>
                    )}

                    {/* Source URL (expanded) */}
                    {isExpanded && item.source_url && (
                      <div style={{ margin: '4px 0', fontSize: '0.78rem' }}>
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2' }}>
                          {item.source_url}
                        </a>
                      </div>
                    )}

                    {/* Timestamp + Publication Date */}
                    <div style={{ fontSize: '0.73rem', color: '#aaa', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                      <span>{formatDate(item.created_at)}</span>
                      {item.moderated_at && <span>&middot; Moderated {formatDate(item.moderated_at)}</span>}
                      {item.content_type !== 'photo' && (() => {
                        const confBadge = getDateConfidenceBadge(item.date_confidence);
                        if (!confBadge) return null;
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <span>&middot;</span>
                            {item.publication_date ? (
                              <span>Pub: {formatPubDate(item.publication_date)}</span>
                            ) : null}
                            <span style={{
                              backgroundColor: confBadge.color, color: 'white',
                              padding: '0px 5px', borderRadius: '8px',
                              fontSize: '0.65rem', fontWeight: 'bold'
                            }}>
                              {confBadge.label}
                            </span>
                          </span>
                        );
                      })()}
                    </div>

                    {/* AI reasoning (expanded) */}
                    {isExpanded && item.ai_reasoning && (
                      <div style={{
                        marginTop: '8px', padding: '8px', backgroundColor: '#f7f7f7',
                        borderRadius: '6px', fontSize: '0.82rem', color: '#444', lineHeight: '1.4'
                      }}>
                        <strong>AI:</strong> {item.ai_reasoning}
                      </div>
                    )}

                    {/* Edit form (expanded, all fields) */}
                    {isEditing && (
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
                        padding: '12px', backgroundColor: '#fffbe6', borderRadius: '6px', border: '1px solid #ffe082' }}>
                        {(FIELD_CONFIGS[item.content_type] || []).map(fc => (
                          <div key={fc.key}>
                            <label style={{ fontSize: '0.78rem', color: '#666', fontWeight: '500', marginBottom: '2px', display: 'block' }}>
                              {fc.label}
                            </label>
                            {renderFieldInput(fc, editFields, setEditFields)}
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <button onClick={() => handleEditPublish(item.content_type, item.id)}
                            style={btnStyle('#4caf50')}>Save & Publish</button>
                          <button onClick={() => { setEditingItem(null); setEditFields({}); }}
                            style={btnStyle('transparent', '#666', '1px solid #ccc')}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '200px' }}>
                    <button onClick={() => setExpandedItem(isExpanded ? null : itemKey)}
                      style={btnStyle('transparent', '#666', '1px solid #ddd')}>
                      {isExpanded ? 'Less' : 'More'}
                    </button>
                    {isPending && (
                      <>
                        <button onClick={() => handleApprove(item.content_type, item.id)}
                          style={btnStyle('#4caf50')}>Approve</button>
                        <button onClick={() => handleReject(item.content_type, item.id)}
                          style={btnStyle('#f44336')}>Reject</button>
                        {item.content_type !== 'photo' && (
                          <button
                            onClick={() => handleResearch(item.content_type, item.id)}
                            disabled={researchingItem === `${item.content_type}:${item.id}`}
                            style={btnStyle(researchingItem === `${item.content_type}:${item.id}` ? '#90caf9' : '#1565c0')}>
                            {researchingItem === `${item.content_type}:${item.id}` ? 'Fixing URL...' : 'Fix URL'}
                          </button>
                        )}
                        <button onClick={() => startEditing(item)}
                          style={btnStyle('transparent', '#e65100', '1px solid #ff9800')}>Edit</button>
                      </>
                    )}
                    {!isPending && (
                      <>
                        <button onClick={() => handleRequeue(item.content_type, item.id)}
                          style={btnStyle('transparent', '#e65100', '1px solid #ff9800')}>Requeue</button>
                        {item.content_type !== 'photo' && (
                          <button
                            onClick={() => handleResearch(item.content_type, item.id)}
                            disabled={researchingItem === `${item.content_type}:${item.id}`}
                            style={btnStyle(
                              researchingItem === `${item.content_type}:${item.id}` ? '#90caf9' : 'transparent',
                              researchingItem === `${item.content_type}:${item.id}` ? 'white' : '#1565c0',
                              researchingItem === `${item.content_type}:${item.id}` ? 'none' : '1px solid #42a5f5'
                            )}>
                            {researchingItem === `${item.content_type}:${item.id}` ? 'Fixing URL...' : 'Fix URL'}
                          </button>
                        )}
                        <button onClick={() => startEditing(item)}
                          style={btnStyle('transparent', '#1565c0', '1px solid #42a5f5')}>Edit</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ ...btnStyle(page === 1 ? '#eee' : '#f0f0f0', page === 1 ? '#ccc' : '#333'), cursor: page === 1 ? 'default' : 'pointer' }}>
            Prev
          </button>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>
            {page} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ ...btnStyle(page === totalPages ? '#eee' : '#f0f0f0', page === totalPages ? '#ccc' : '#333'), cursor: page === totalPages ? 'default' : 'pointer' }}>
            Next
          </button>
        </div>
      )}

      {/* Notification */}
      {notification && (
        <div className={`result-message ${notification.type}`} style={{ marginTop: '10px' }}>
          {notification.message}
        </div>
      )}
    </div>
  );
}

export default ModerationInbox;
