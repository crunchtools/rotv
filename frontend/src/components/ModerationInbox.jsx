import React, { useState, useEffect, useCallback } from 'react';

function ModerationInbox() {
  const [queue, setQueue] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [expandedItem, setExpandedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [notification, setNotification] = useState(null);
  const LIMIT = 20;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT });
      if (filter) params.set('type', filter);
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
  }, [page, filter]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleApprove = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, id })
      });
      if (response.ok) {
        setNotification({ type: 'success', message: `${type} #${id} approved` });
        fetchQueue();
      }
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    }
  };

  const handleReject = async (type, id) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      const response = await fetch('/api/admin/moderation/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, id, reason: reason || '' })
      });
      if (response.ok) {
        setNotification({ type: 'success', message: `${type} #${id} rejected` });
        fetchQueue();
      }
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    }
  };

  const handleBulkApprove = async () => {
    if (selectedItems.size === 0) return;
    const items = Array.from(selectedItems).map(key => {
      const [type, id] = key.split(':');
      return { type, id: parseInt(id) };
    });

    try {
      const response = await fetch('/api/admin/moderation/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items })
      });
      if (response.ok) {
        const data = await response.json();
        setNotification({ type: 'success', message: `${data.approved} items approved` });
        setSelectedItems(new Set());
        fetchQueue();
      }
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    }
  };

  const handleEditPublish = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/edit-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, id, edits: editFields })
      });
      if (response.ok) {
        setNotification({ type: 'success', message: `${type} #${id} edited and published` });
        setEditingItem(null);
        setEditFields({});
        fetchQueue();
      }
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    }
  };

  const toggleSelect = (type, id) => {
    const key = `${type}:${id}`;
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="moderation-inbox">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>Moderation Queue</h3>
        <span style={{
          backgroundColor: total > 0 ? '#f44336' : '#4caf50',
          color: 'white',
          padding: '2px 10px',
          borderRadius: '12px',
          fontSize: '0.85rem',
          fontWeight: 'bold'
        }}>
          {total} pending
        </span>
      </div>

      {/* Filter buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'All', value: null },
          { label: 'News', value: 'news' },
          { label: 'Events', value: 'event' },
          { label: 'Photos', value: 'photo' }
        ].map(f => (
          <button
            key={f.label}
            onClick={() => { setFilter(f.value); setPage(1); }}
            style={{
              padding: '4px 12px',
              borderRadius: '16px',
              border: filter === f.value ? '2px solid #333' : '1px solid #ccc',
              backgroundColor: filter === f.value ? '#333' : 'transparent',
              color: filter === f.value ? 'white' : '#333',
              cursor: 'pointer',
              fontSize: '0.85rem'
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {queue.length > 0 && (
        <div style={{
          display: 'flex', gap: '10px', alignItems: 'center',
          marginBottom: '1rem', padding: '8px 12px',
          backgroundColor: '#f5f5f5', borderRadius: '6px'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={selectedItems.size === queue.length && queue.length > 0}
              onChange={selectAll}
            />
            Select All
          </label>
          <button
            className="action-btn primary"
            onClick={handleBulkApprove}
            disabled={selectedItems.size === 0}
            style={{ padding: '4px 12px', fontSize: '0.85rem' }}
          >
            Approve Selected ({selectedItems.size})
          </button>
        </div>
      )}

      {/* Queue items */}
      {loading ? (
        <p>Loading moderation queue...</p>
      ) : queue.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem',
          color: '#999', fontSize: '1rem'
        }}>
          No pending items. All content has been reviewed.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {queue.map(item => {
            const itemKey = `${item.content_type}:${item.id}`;
            const isExpanded = expandedItem === itemKey;
            const isEditing = editingItem === itemKey;

            return (
              <div key={itemKey} style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                padding: '12px',
                backgroundColor: selectedItems.has(itemKey) ? '#e3f2fd' : 'white'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <input
                    type="checkbox"
                    checked={selectedItems.has(itemKey)}
                    onChange={() => toggleSelect(item.content_type, item.id)}
                    style={{ marginTop: '4px' }}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      {/* Type badge */}
                      <span style={{
                        backgroundColor: getTypeBadgeColor(item.content_type),
                        color: 'white',
                        padding: '1px 8px',
                        borderRadius: '10px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        textTransform: 'uppercase'
                      }}>
                        {item.content_type}
                      </span>

                      {/* Title */}
                      <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>
                        {item.title || '(untitled)'}
                      </span>

                      {/* Confidence meter */}
                      {item.confidence_score !== null && item.confidence_score !== undefined && (
                        <span style={{
                          color: getConfidenceColor(item.confidence_score),
                          fontWeight: 'bold',
                          fontSize: '0.85rem',
                          marginLeft: 'auto'
                        }}>
                          {(item.confidence_score * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    {/* Description preview */}
                    {item.description && (
                      <p style={{
                        margin: '4px 0',
                        fontSize: '0.85rem',
                        color: '#555',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: isExpanded ? 'unset' : 2,
                        WebkitBoxOrient: 'vertical'
                      }}>
                        {item.description}
                      </p>
                    )}

                    {/* Timestamp */}
                    <span style={{ fontSize: '0.75rem', color: '#999' }}>
                      {formatDate(item.created_at)}
                    </span>

                    {/* Expanded: AI reasoning */}
                    {isExpanded && item.ai_reasoning && (
                      <div style={{
                        marginTop: '8px', padding: '8px',
                        backgroundColor: '#f9f9f9', borderRadius: '4px',
                        fontSize: '0.85rem', color: '#333'
                      }}>
                        <strong>AI Reasoning:</strong> {item.ai_reasoning}
                      </div>
                    )}

                    {/* Inline editor */}
                    {isEditing && (
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <input
                          type="text"
                          value={editFields.title || item.title || ''}
                          onChange={e => setEditFields({ ...editFields, title: e.target.value })}
                          placeholder="Title"
                          style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                        <textarea
                          value={editFields[item.content_type === 'news' ? 'summary' : item.content_type === 'photo' ? 'caption' : 'description'] || item.description || ''}
                          onChange={e => {
                            const field = item.content_type === 'news' ? 'summary' : item.content_type === 'photo' ? 'caption' : 'description';
                            setEditFields({ ...editFields, [field]: e.target.value });
                          }}
                          placeholder="Content"
                          rows={3}
                          style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            className="action-btn primary"
                            onClick={() => handleEditPublish(item.content_type, item.id)}
                            style={{ padding: '4px 12px', fontSize: '0.85rem' }}
                          >
                            Save & Publish
                          </button>
                          <button
                            className="action-btn secondary"
                            onClick={() => { setEditingItem(null); setEditFields({}); }}
                            style={{ padding: '4px 12px', fontSize: '0.85rem' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={() => setExpandedItem(isExpanded ? null : itemKey)}
                      title={isExpanded ? 'Collapse' : 'Expand'}
                      style={{
                        padding: '4px 8px', border: '1px solid #ccc',
                        borderRadius: '4px', backgroundColor: 'transparent',
                        cursor: 'pointer', fontSize: '0.8rem'
                      }}
                    >
                      {isExpanded ? 'Less' : 'More'}
                    </button>
                    <button
                      onClick={() => handleApprove(item.content_type, item.id)}
                      title="Approve"
                      style={{
                        padding: '4px 8px', border: 'none',
                        borderRadius: '4px', backgroundColor: '#4caf50',
                        color: 'white', cursor: 'pointer', fontSize: '0.8rem'
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(item.content_type, item.id)}
                      title="Reject"
                      style={{
                        padding: '4px 8px', border: 'none',
                        borderRadius: '4px', backgroundColor: '#f44336',
                        color: 'white', cursor: 'pointer', fontSize: '0.8rem'
                      }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => {
                        setEditingItem(isEditing ? null : itemKey);
                        setEditFields({});
                      }}
                      title="Edit & Publish"
                      style={{
                        padding: '4px 8px', border: '1px solid #ff9800',
                        borderRadius: '4px', backgroundColor: 'transparent',
                        color: '#ff9800', cursor: 'pointer', fontSize: '0.8rem'
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '1rem' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ padding: '4px 12px', cursor: page === 1 ? 'default' : 'pointer' }}
          >
            Previous
          </button>
          <span style={{ padding: '4px 8px', fontSize: '0.9rem' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ padding: '4px 12px', cursor: page === totalPages ? 'default' : 'pointer' }}
          >
            Next
          </button>
        </div>
      )}

      {/* Result notification */}
      {notification && (
        <div className={`result-message ${notification.type}`} style={{ marginTop: '1rem' }}>
          {notification.message}
        </div>
      )}
    </div>
  );
}

export default ModerationInbox;
