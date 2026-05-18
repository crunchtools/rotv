import React, { useState, useEffect, useCallback } from 'react';
import Lightbox from './Lightbox';
import { NewsCardBody, EventCardBody, formatPublicationDate } from './NewsEventsShared';
import useModeration, { FIELD_CONFIGS } from '../hooks/useModeration';
import ModerationExtras, { btnStyle, inputStyle, renderFieldInput, badgeStyle, actionBtn } from './ModerationExtras';

function ModerationInbox({ onCountChange, focusItemId, focusItemTitle, onSelectPoi }) {
  const [queue, setQueue] = useState([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(() => focusItemId ? 'all' : 'pending');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(null);
  const [createFields, setCreateFields] = useState({});
  const [sourceFilter, setSourceFilter] = useState(null);
  const [sortOrder, setSortOrder] = useState('collected_desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState(() => focusItemTitle || '');
  const [idFilter, setIdFilter] = useState(() => focusItemId || null);
  const [lightboxMedia, setLightboxMedia] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxPoiId, setLightboxPoiId] = useState(null);
  const [user, setUser] = useState(null);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const fetchQueue = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT, status: statusFilter, sort: sortOrder });
      if (filter) params.set('type', filter);
      if (sourceFilter) params.set('source', sourceFilter);
      if (idFilter) {
        params.set('id', idFilter);
      } else if (searchQuery) {
        params.set('search', searchQuery);
      }
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
      if (!silent) setLoading(false);
    }
  }, [page, filter, statusFilter, sourceFilter, searchQuery, idFilter, sortOrder]);

  const mod = useModeration({
    onItemsChanged: fetchQueue,
    onCountChange
  });

  useEffect(() => { fetchQueue(); mod.selectedItems && mod.toggleSelect && null; }, [fetchQueue]);

  useEffect(() => {
    const interval = setInterval(() => fetchQueue({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  useEffect(() => {
    fetch('/api/user', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data))
      .catch(() => setUser(null));
  }, []);

  const startEditingRef = React.useRef(null);
  useEffect(() => {
    if (!focusItemId) return;
    setStatusFilter('all');
    setFilter(null);
    setSourceFilter(null);
    setSearchQuery('');
    setSearchInput(focusItemTitle || '');
    setIdFilter(focusItemId);
    setPage(1);
  }, [focusItemId, focusItemTitle]);

  useEffect(() => {
    if (!focusItemId || loading || queue.length === 0) return;
    const item = queue.find(i => i.id === focusItemId && i.content_type === 'news');
    if (!item) return;
    if (startEditingRef.current) startEditingRef.current(item);
  }, [focusItemId, loading, queue]);

  useEffect(() => { startEditingRef.current = mod.startEditing; });

  const [expandedItem, setExpandedItem] = useState(null);
  useEffect(() => {
    if (mod.editingItem) setExpandedItem(mod.editingItem);
  }, [mod.editingItem]);
  useEffect(() => {
    if (!expandedItem) return;
    const el = document.getElementById(`moderation-item-${expandedItem}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [expandedItem]);

  const isPending = statusFilter === 'pending';

  const getThumbnailUrl = (item) => {
    if (!item.media_type) return null;
    if (item.media_type === 'youtube') {
      const videoId = item.source_url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1];
      return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
    } else if (item.image_server_asset_id && (item.media_type === 'image' || item.media_type === 'video')) {
      return `/api/assets/${item.image_server_asset_id}/thumbnail`;
    }
    return null;
  };

  const handleOpenLightbox = async (item) => {
    if (!item.poi_id) return;
    try {
      const response = await fetch(`/api/pois/${item.poi_id}/media`, { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      const allMedia = data.all_media || [];
      const index = allMedia.findIndex(m => m.id === item.id);
      setLightboxMedia(allMedia);
      setLightboxIndex(index >= 0 ? index : 0);
      setLightboxPoiId(item.poi_id);
    } catch (err) { console.error('Failed to load media for lightbox:', err); }
  };

  const handleMediaUpdate = () => {
    fetchQueue();
    if (lightboxPoiId) {
      fetch(`/api/pois/${lightboxPoiId}/media`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => setLightboxMedia(data.all_media || []))
        .catch(err => console.error('Failed to refresh lightbox media:', err));
    }
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
        mod.notify('success', `Created ${creating} #${data.id}`);
        setCreating(null);
        setCreateFields({});
        fetchQueue();
      } else {
        const err = await response.json();
        mod.notify('error', err.error || 'Create failed');
      }
    } catch (err) { mod.notify('error', err.message); }
  };

  const handleBulkRejectAll = async () => {
    const pendingItems = queue.filter(q => q.moderation_status === 'pending');
    if (pendingItems.length === 0) return;
    if (!window.confirm(`Reject all ${pendingItems.length} pending items?`)) return;
    try {
      const items = pendingItems.map(q => ({ type: q.content_type, id: q.id }));
      const response = await fetch('/api/admin/moderation/bulk-reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ items })
      });
      if (response.ok) {
        const data = await response.json();
        mod.notify('success', `Rejected ${data.rejected} items`);
        fetchQueue();
        if (onCountChange) onCountChange();
      }
    } catch (err) { mod.notify('error', err.message); }
  };

  const filterBtn = (active) => ({
    padding: '5px 0', borderRadius: '6px', border: '1px solid #ddd',
    backgroundColor: active ? '#333' : '#f5f5f5', color: active ? 'white' : '#555',
    cursor: 'pointer', fontSize: '0.78rem', fontWeight: active ? '600' : '400',
    flex: 1, textAlign: 'center'
  });

  const modExtrasProps = {
    editingItem: mod.editingItem,
    editFields: mod.editFields,
    setEditFields: mod.setEditFields,
    itemUrls: mod.itemUrls,
    newUrlInput: mod.newUrlInput,
    setNewUrlInput: mod.setNewUrlInput,
    addingUrl: mod.addingUrl,
    iaDateItem: mod.iaDateItem,
    mergingItem: mod.mergingItem,
    mergeCandidates: mod.mergeCandidates,
    merging: mod.merging,
    confirmDelete: mod.confirmDelete,
    setConfirmDelete: mod.setConfirmDelete,
    selectedItems: mod.selectedItems,
    pois: mod.pois,
    onApprove: mod.handleApprove,
    onReject: mod.handleReject,
    onRequeue: mod.handleRequeue,
    onDelete: mod.handleDelete,
    onSave: mod.handleSave,
    onIaDate: mod.handleIaDate,
    onStartEditing: mod.startEditing,
    onCancelEditing: mod.cancelEditing,
    onStartMerge: mod.startMerge,
    onMerge: mod.handleMerge,
    onCancelMerge: mod.cancelMerge,
    onAddUrl: mod.handleAddUrl,
    onRemoveUrl: mod.handleRemoveUrl,
    onToggleSelect: mod.toggleSelect
  };

  return (
    <div className="moderation-inbox">

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Moderation Queue</h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {statusFilter === 'pending' && queue.length > 0 && (
            <button onClick={handleBulkRejectAll} style={btnStyle('#b71c1c')}>
              Reject All
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setCreating(creating ? null : 'news')}
              style={btnStyle(creating ? '#333' : '#4caf50')}>
              + Create
            </button>
          </div>
        </div>
      </div>


      <div style={{ marginBottom: '8px' }}>
        <input type="text" value={searchInput}
          onChange={e => { setSearchInput(e.target.value); if (!e.target.value) { setIdFilter(null); setSearchQuery(''); setPage(1);} }}
          onKeyDown={e => { if (e.key === 'Enter') { setIdFilter(null); setSearchQuery(searchInput); setPage(1);} }}
          placeholder="Search by title or description..."
          style={{ width: '100%', padding: '8px 12px', fontSize: '0.88rem',
            border: '1px solid #d0d0d0', borderRadius: '6px', boxSizing: 'border-box' }}
        />
      </div>


      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[{ label: 'All Types', value: null }, { label: 'News', value: 'news' }, { label: 'Events', value: 'event' }, { label: 'Photos', value: 'photo' }].map(f => (
            <button key={f.label} onClick={() => {
              setFilter(f.value);
              if (f.value === 'event') setSortOrder('date_asc');
              else if (f.value !== filter) setSortOrder('collected_desc');
              setPage(1);
            }} style={filterBtn(filter === f.value)}>{f.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[{ label: 'All Sources', value: null }, { label: 'AI', value: 'ai' }, { label: 'Human', value: 'human' }, { label: 'Newsletter', value: 'newsletter' }].map(f => (
            <button key={`src-${f.label}`} onClick={() => { setSourceFilter(f.value); setPage(1);}}
              style={filterBtn(sourceFilter === f.value)}>{f.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[{ label: 'All', value: 'all' }, { label: 'Pending', value: 'pending' }, { label: 'Approved', value: 'approved' }, { label: 'Rejected', value: 'rejected' }].map(f => (
            <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(1);}}
              style={filterBtn(statusFilter === f.value)}>{f.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {[
            { label: 'Collected \u2193', value: 'collected_desc' }, { label: 'Collected \u2191', value: 'collected_asc' },
            { label: 'Date \u2191', value: 'date_asc' }, { label: 'Date \u2193', value: 'date_desc' },
            { label: 'POI A\u2192Z', value: 'poi_asc' }, { label: 'POI Z\u2192A', value: 'poi_desc' }
          ].map(f => (
            <button key={f.value} onClick={() => { setSortOrder(f.value); setPage(1);}}
              style={filterBtn(sortOrder === f.value)}>{f.label}</button>
          ))}
        </div>
      </div>


      {creating && (
        <div style={{ border: '2px solid #4caf50', borderRadius: '8px', padding: '16px',
          marginBottom: '12px', backgroundColor: '#f9fff9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0 }}>Create New Content</h4>
            <button onClick={() => { setCreating(null); setCreateFields({}); }}
              style={{ ...btnStyle('transparent', '#999', '1px solid #ccc'), fontSize: '0.75rem' }}>Cancel</button>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {['news', 'event', 'photo'].map(t => (
              <button key={t} onClick={() => { setCreating(t); setCreateFields({}); }}
                style={filterBtn(creating === t)}>
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
                {renderFieldInput(fc, createFields, setCreateFields, mod.pois)}
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


      {isPending && queue.length > 0 && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center',
          marginBottom: '10px', padding: '6px 12px',
          backgroundColor: '#f5f5f5', borderRadius: '6px', fontSize: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={mod.selectedItems.size === queue.length && queue.length > 0}
              onChange={() => mod.selectAll(queue)} />
            Select All
          </label>
          <button onClick={() => mod.handleBulkApprove(queue)} disabled={mod.selectedItems.size === 0}
            style={{ ...btnStyle(mod.selectedItems.size > 0 ? '#4caf50' : '#ccc'), padding: '3px 10px' }}>
            Approve Selected ({mod.selectedItems.size})
          </button>
        </div>
      )}


      {loading ? (
        <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>Loading...</p>
      ) : queue.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>
          {isPending ? 'No pending items.' : `No ${statusFilter} items found.`}
        </div>
      ) : (
        <div className="park-news-list" style={{ gap: '6px' }}>
          {queue.map(item => {
            const itemKey = `${item.content_type}:${item.id}`;

            if (item.content_type === 'news') {
              return (
                <NewsCardBody key={itemKey} item={{ ...item, summary: item.description }}
                  id={`moderation-item-${itemKey}`} onSelectPoi={onSelectPoi}>
                  <ModerationExtras item={item} isPending={isPending} {...modExtrasProps} />
                </NewsCardBody>
              );
            } else if (item.content_type === 'event') {
              return (
                <EventCardBody key={itemKey} item={item}
                  id={`moderation-item-${itemKey}`} onSelectPoi={onSelectPoi}>
                  <ModerationExtras item={item} isPending={isPending} {...modExtrasProps} />
                </EventCardBody>
              );
            } else {
              return (
                <div key={itemKey} id={`moderation-item-${itemKey}`} style={{
                  border: '1px solid #e0e0e0', borderRadius: '8px', padding: '10px 12px',
                  backgroundColor: 'white'
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.92rem', marginBottom: '4px' }}>
                    {item.title || '(untitled)'}
                  </div>
                  {getThumbnailUrl(item) && (
                    <div onClick={() => handleOpenLightbox(item)}
                      style={{ width: '120px', height: '90px', borderRadius: '6px',
                        overflow: 'hidden', cursor: 'pointer', margin: '6px 0',
                        border: '1px solid #e0e0e0', position: 'relative', flexShrink: 0 }}>
                      <img src={getThumbnailUrl(item)} alt={item.title || 'Media'}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {item.media_type === 'video' && (
                        <div style={{ position: 'absolute', top: '50%', left: '50%',
                          transform: 'translate(-50%, -50%)', fontSize: '2rem', color: 'white',
                          textShadow: '0 0 4px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>▶</div>
                      )}
                      {item.media_type === 'youtube' && (
                        <div style={{ position: 'absolute', bottom: '4px', right: '4px',
                          backgroundColor: 'rgba(255,0,0,0.9)', color: 'white', padding: '2px 6px',
                          borderRadius: '3px', fontSize: '0.7rem', fontWeight: 'bold', pointerEvents: 'none' }}>YT</div>
                      )}
                    </div>
                  )}
                  {item.description && <p style={{ margin: '4px 0', fontSize: '0.83rem', color: '#555' }}>{item.description}</p>}
                  <ModerationExtras item={item} isPending={isPending} {...modExtrasProps} />
                </div>
              );
            }
          })}
        </div>
      )}


      {!loading && Math.ceil(total / LIMIT) > 1 && (
        <div className="pagination-controls">
          <button className="pagination-btn" onClick={() => setPage(p => p - 1)} disabled={page === 1}>Back</button>
          <span className="pagination-info">Page {page} of {Math.ceil(total / LIMIT)}</span>
          <button className="pagination-btn" onClick={() => setPage(p => p + 1)} disabled={page === Math.ceil(total / LIMIT)}>Next</button>
        </div>
      )}


      {mod.notification && (
        <div className={`result-message ${mod.notification.type}`} style={{ marginTop: '10px' }}>
          {mod.notification.message}
        </div>
      )}


      {lightboxMedia && (
        <Lightbox media={lightboxMedia} initialIndex={lightboxIndex} onClose={() => { setLightboxMedia(null); setLightboxIndex(0); setLightboxPoiId(null); }}
          poiId={lightboxPoiId} user={user} onMediaUpdate={handleMediaUpdate} />
      )}
    </div>
  );
}

export default ModerationInbox;
