import React, { useState, useEffect, useCallback } from 'react';
import Lightbox from './Lightbox';
import PoiSearchSelect from './PoiSearchSelect';
import { NewsCardBody, EventCardBody, formatPublicationDate } from './NewsEventsShared';

// Eastern timezone abbreviation (EST or EDT) for datetime labels
const TZ_ABBR = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' }).split(' ').pop();

const FIELD_CONFIGS = {
  news: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'source_name', label: 'Source Name', type: 'text' },
    { key: 'news_type', label: 'Type', type: 'select', options: ['general', 'closure', 'seasonal', 'maintenance', 'wildlife'] },
    { key: 'publication_date', label: `Publication Date (${TZ_ABBR})`, type: 'datetime-local' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
    { key: 'source_url', label: 'Primary URL', type: 'text' },
  ],
  event: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'start_date', label: `Start Date/Time (${TZ_ABBR})`, type: 'datetime-local', required: true },
    { key: 'end_date', label: `End Date/Time (${TZ_ABBR})`, type: 'datetime-local' },
    { key: 'event_type', label: 'Event Type', type: 'text' },
    { key: 'location_details', label: 'Location Details', type: 'text' },
    { key: 'publication_date', label: `Publication Date (${TZ_ABBR})`, type: 'datetime-local' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
    { key: 'source_url', label: 'Primary URL', type: 'text' },
  ],
  photo: [
    { key: 'caption', label: 'Caption', type: 'textarea' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
  ]
};

function ModerationInbox({ onCountChange, focusItemId, focusItemTitle, onSelectPoi }) {
  const [queue, setQueue] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(null);
  // Lazy-initialize statusFilter/searchInput/idFilter from props so the very first
  // fetchQueue already has the right values — avoids a race condition where the
  // initial fetch fires with default state before effects run.
  const [statusFilter, setStatusFilter] = useState(() => focusItemId ? 'all' : 'pending');
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
  const [fixingDateItem, setFixingDateItem] = useState(null);
  const [mergingItem, setMergingItem] = useState(null); // { type, id, poiId }
  const [mergeCandidates, setMergeCandidates] = useState([]);
  const [merging, setMerging] = useState(false);
  const [itemUrls, setItemUrls] = useState({}); // { "news:123": [{id, url, source_name}] }
  const [newUrlInput, setNewUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState(() => focusItemTitle || '');
  // idFilter drives API fetch by ID (exactly 1 result) when coming from Edit link
  const [idFilter, setIdFilter] = useState(() => focusItemId || null);
  const [lightboxMedia, setLightboxMedia] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxPoiId, setLightboxPoiId] = useState(null);
  const [user, setUser] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // "news:123" key
  const LIMIT = 20;

  // Handle focusItemId changes (e.g. user clicks Edit on a second article without
  // leaving the Moderation tab — the component stays mounted but props change).
  const startEditingRef = React.useRef(null);
  useEffect(() => {
    if (!focusItemId) return;
    setStatusFilter('all');
    setFilter(null);
    setSourceFilter(null);
    setSearchQuery('');
    setPage(1);
    setSearchInput(focusItemTitle || '');
    setIdFilter(focusItemId);
  }, [focusItemId, focusItemTitle]);

  // After queue loads, auto-expand and open edit mode for the focused item
  useEffect(() => {
    if (!focusItemId || loading || queue.length === 0) return;
    const item = queue.find(i => i.id === focusItemId && i.content_type === 'news');
    if (!item) return;
    const itemKey = `news:${item.id}`;
    setExpandedItem(itemKey);
    if (startEditingRef.current) startEditingRef.current(item);
  }, [focusItemId, loading, queue]);

  // Scroll focused item into view after it expands
  useEffect(() => {
    if (!expandedItem) return;
    const el = document.getElementById(`moderation-item-${expandedItem}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [expandedItem]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: LIMIT, status: statusFilter });
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
      setLoading(false);
    }
  }, [page, filter, statusFilter, sourceFilter, searchQuery, idFilter]);

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

    fetch('/api/user', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUser(data))
      .catch(() => setUser(null));
  }, []);

  const notify = (type, message) => setNotification({ type, message });

  const getThumbnailUrl = (item) => {
    if (!item.media_type) return null;

    if (item.media_type === 'youtube') {
      // Extract video ID from YouTube URL
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
      // Fetch all media for this POI
      const response = await fetch(`/api/pois/${item.poi_id}/media`, { credentials: 'include' });
      if (!response.ok) return;

      const data = await response.json();
      const allMedia = data.all_media || [];

      // Find the index of the clicked item
      const index = allMedia.findIndex(m => m.id === item.id);

      setLightboxMedia(allMedia);
      setLightboxIndex(index >= 0 ? index : 0);
      setLightboxPoiId(item.poi_id);
    } catch (err) {
      console.error('Failed to load media for lightbox:', err);
    }
  };

  const handleLightboxClose = () => {
    setLightboxMedia(null);
    setLightboxIndex(0);
    setLightboxPoiId(null);
  };

  const handleMediaUpdate = () => {
    fetchQueue();
    if (lightboxPoiId) {
      // Refresh lightbox media
      fetch(`/api/pois/${lightboxPoiId}/media`, { credentials: 'include' })
        .then(r => r.json())
        .then(data => setLightboxMedia(data.all_media || []))
        .catch(err => console.error('Failed to refresh lightbox media:', err));
    }
  };

  const handleApprove = async (type, id) => {
    try {
      // Find the item to get its POI ID before approval
      const item = queue.find(q => q.content_type === type && q.id === id);
      console.log('[Moderation] Approving:', { type, id, item });
      const response = await fetch('/api/admin/moderation/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) {
        notify('success', `${type} #${id} approved`);
        fetchQueue();
        console.log('[Moderation] Calling onCountChange:', !!onCountChange);
        if (onCountChange) onCountChange();
        // Emit event to refresh media for this POI
        if (type === 'photo' && item?.poi_id) {
          console.log('[Moderation] Emitting poi-media-updated event for POI', item.poi_id);
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: item.poi_id } }));
          // Also emit event to refresh map markers (in case this was a primary image change)
          window.dispatchEvent(new CustomEvent('poi-updated', { detail: { poiId: item.poi_id } }));
        }
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleReject = async (type, id) => {
    try {
      const item = queue.find(q => q.content_type === type && q.id === id);
      const response = await fetch('/api/admin/moderation/reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id, reason: '' })
      });
      if (response.ok) {
        notify('success', `${type} #${id} rejected`);
        fetchQueue();
        if (onCountChange) onCountChange();
        // Emit event to refresh media for this POI
        if (type === 'photo' && item?.poi_id) {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: item.poi_id } }));
        }
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleBulkApprove = async () => {
    if (selectedItems.size === 0) return;
    const items = Array.from(selectedItems).map(key => {
      const [type, id] = key.split(':');
      return { type, id: parseInt(id) };
    });
    // Collect unique POI IDs for photo items
    const photoPoiIds = new Set();
    items.forEach(({ type, id }) => {
      if (type === 'photo') {
        const item = queue.find(q => q.content_type === type && q.id === id);
        if (item?.poi_id) photoPoiIds.add(item.poi_id);
      }
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
        if (onCountChange) onCountChange();
        // Emit events for all affected POIs
        photoPoiIds.forEach(poiId => {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId } }));
        });
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleRequeue = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/requeue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) { notify('success', `${type} #${id} requeued`); fetchQueue(); if (onCountChange) onCountChange(); }
    } catch (err) { notify('error', err.message); }
  };

  const handleDelete = async (type, id) => {
    const endpoint = type === 'news' ? `/api/admin/news/${id}` : `/api/admin/events/${id}`;
    try {
      const response = await fetch(endpoint, { method: 'DELETE', credentials: 'include' });
      if (response.ok) {
        setQueue(prev => prev.filter(i => !(i.content_type === type && i.id === id)));
        setConfirmDelete(null);
        notify('success', `${type} #${id} deleted`);
        if (onCountChange) onCountChange();
      } else {
        notify('error', `Failed to delete ${type} #${id}`);
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleFixDate = async (type, id) => {
    const itemKey = `${type}:${id}`;
    setFixingDateItem(itemKey);
    try {
      const response = await fetch('/api/admin/moderation/fix-date', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.date_updated) {
          const parts = [`${type} #${id} — date set: ${data.publication_date} (score=${data.date_consensus_score})`];
          if (data.start_date) parts.push(`event: ${data.start_date}${data.end_date ? ' — ' + data.end_date : ''}`);
          notify('success', parts.join(', '));
        } else {
          notify('success', `${type} #${id} — could not determine date`);
        }
        fetchQueue();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Fix Date failed');
      }
    } catch (err) { notify('error', err.message); }
    finally { setFixingDateItem(null); }
  };

  const startMerge = async (item) => {
    setMergingItem({ type: item.content_type, id: item.id, poiId: item.poi_id });
    setMergeCandidates([]);
    try {
      const response = await fetch(`/api/admin/moderation/merge-candidates/${item.content_type}/${item.id}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const candidates = await response.json();
        setMergeCandidates(candidates);
      } else {
        notify('error', 'Failed to load merge candidates');
        setMergingItem(null);
      }
    } catch (err) {
      notify('error', err.message);
      setMergingItem(null);
    }
  };

  const handleMerge = async (targetId) => {
    if (!mergingItem) return;
    setMerging(true);
    try {
      const response = await fetch('/api/admin/moderation/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: mergingItem.type, sourceId: mergingItem.id, targetId })
      });
      if (response.ok) {
        const data = await response.json();
        notify('success', `Merged ${mergingItem.type} #${mergingItem.id} into #${targetId} (${data.movedUrls} URLs moved)`);
        setMergingItem(null);
        setMergeCandidates([]);
        fetchQueue();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Merge failed');
      }
    } catch (err) { notify('error', err.message); }
    finally { setMerging(false); }
  };

  const fetchItemUrls = async (type, id) => {
    const itemKey = `${type}:${id}`;
    try {
      const response = await fetch(`/api/admin/moderation/item/${type}/${id}`, { credentials: 'include' });
      if (response.ok) {
        const detail = await response.json();
        setItemUrls(prev => ({ ...prev, [itemKey]: detail.additional_urls || [] }));
      }
    } catch (err) { console.error('Error fetching item URLs:', err); }
  };

  const handleAddUrl = async (type, id) => {
    if (!newUrlInput.trim()) return;
    setAddingUrl(true);
    try {
      const response = await fetch('/api/admin/moderation/add-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, id, url: newUrlInput.trim() })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.added) {
          notify('success', 'URL added');
          setNewUrlInput('');
          fetchItemUrls(type, id);
          fetchQueue();
        } else {
          notify('error', data.reason || 'URL not added');
        }
      } else {
        const err = await response.json();
        notify('error', err.error || 'Failed to add URL');
      }
    } catch (err) { notify('error', err.message); }
    finally { setAddingUrl(false); }
  };

  const handleRemoveUrl = async (type, contentId, urlId) => {
    try {
      const response = await fetch('/api/admin/moderation/remove-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, id: contentId, urlId })
      });
      if (response.ok) {
        notify('success', 'URL removed');
        fetchItemUrls(type, contentId);
        fetchQueue();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Failed to remove URL');
      }
    } catch (err) { notify('error', err.message); }
  };

  const startEditing = async (item) => {
    const itemKey = `${item.content_type}:${item.id}`;
    if (editingItem === itemKey) {
      setEditingItem(null);
      setEditFields({});
      return;
    }
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
            const raw = String(detail[fc.key]);
            // Convert UTC/pg timestamp to Eastern for display in datetime-local input
            const utcDate = new Date(raw.replace(' ', 'T').replace(/\+\d{2}$/, 'Z'));
            if (!isNaN(utcDate.getTime())) {
              const eastern = utcDate.toLocaleString('sv-SE', { timeZone: 'America/New_York' });
              fields[fc.key] = eastern.replace(' ', 'T').substring(0, 16);
            } else {
              const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
              fields[fc.key] = match ? `${match[1]}T${match[2]}` : raw.slice(0, 16);
            }
          } else {
            fields[fc.key] = detail[fc.key] || '';
          }
        }
        setEditFields(fields);
        setEditingItem(itemKey);
        // Load additional URLs for the edit form
        if (item.content_type !== 'photo') {
          setItemUrls(prev => ({ ...prev, [itemKey]: detail.additional_urls || [] }));
        }
      }
    } catch (err) {
      notify('error', 'Failed to load item details');
    }
  };

  // Keep ref current so the auto-focus effect can call startEditing without it as a dep
  useEffect(() => { startEditingRef.current = startEditing; });

  const handleSave = async (type, id) => {
    console.log('[Moderation] Saving:', { type, id, edits: editFields });
    const item = queue.find(q => q.content_type === type && q.id === id);
    try {
      const response = await fetch('/api/admin/moderation/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id, edits: editFields })
      });
      if (response.ok) {
        console.log('[Moderation] Save successful');
        notify('success', `${type} #${id} saved`);
        setEditingItem(null);
        setEditFields({});
        fetchQueue();
        // Emit event to refresh media for this POI (in case caption or POI changed)
        if (type === 'photo' && item?.poi_id) {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: item.poi_id } }));
          // Also emit for the new POI if it changed
          if (editFields.poi_id && editFields.poi_id !== item.poi_id) {
            window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: editFields.poi_id } }));
          }
        }
      } else {
        const err = await response.json();
        console.error('[Moderation] Save failed:', err);
        notify('error', err.error || 'Save failed');
      }
    } catch (err) {
      console.error('[Moderation] Save error:', err);
      notify('error', err.message);
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

  const isPending = statusFilter === 'pending';
  const totalPages = Math.ceil(total / LIMIT);

  const filterBtn = (active) => ({
    padding: '5px 0',
    borderRadius: '6px',
    border: '1px solid #ddd',
    backgroundColor: active ? '#333' : '#f5f5f5',
    color: active ? 'white' : '#555',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: active ? '600' : '400',
    flex: 1,
    textAlign: 'center'
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
        <PoiSearchSelect
          pois={pois}
          value={val}
          onChange={(id) => onChange(id || '')}
          placeholder="Search POIs..."
        />
      );
    }
    // lang="en-US" forces MM/DD/YYYY display regardless of browser language locale
    const lang = fc.type === 'date' ? 'en-US' : undefined;
    return (
      <input type={fc.type || 'text'} value={val} onChange={e => onChange(e.target.value)}
        style={inputStyle} placeholder={fc.label} required={fc.required} lang={lang} />
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

  const badgeStyle = (bg) => ({
    backgroundColor: bg, color: 'white', padding: '1px 8px', borderRadius: '10px',
    fontSize: '0.72rem', fontWeight: 'bold', textTransform: 'uppercase'
  });

  const actionBtn = (disabled = false) => ({
    padding: '4px 0', border: '1px solid #bbb', borderRadius: '5px',
    backgroundColor: disabled ? '#e0e0e0' : '#f5f5f5', color: disabled ? '#999' : '#333',
    cursor: disabled ? 'default' : 'pointer', fontSize: '0.75rem', fontWeight: '500',
    width: '72px', textAlign: 'center'
  });

  return (
    <div className="moderation-inbox">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>Moderation Queue</h3>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
          {/* Reject All visible pending items */}
          {statusFilter === 'pending' && queue.length > 0 && (
            <button
              onClick={async () => {
                const pendingItems = queue.filter(q => q.moderation_status === 'pending');
                if (pendingItems.length === 0) return;
                if (!window.confirm(`Reject all ${pendingItems.length} pending items on this page?`)) return;
                try {
                  const items = pendingItems.map(q => ({ type: q.content_type, id: q.id }));
                  const response = await fetch('/api/admin/moderation/bulk-reject', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', body: JSON.stringify({ items })
                  });
                  if (response.ok) {
                    const data = await response.json();
                    notify('success', `Rejected ${data.rejected} items`);
                    fetchQueue();
                    if (onCountChange) onCountChange();
                  }
                } catch (err) { notify('error', err.message); }
              }}
              style={btnStyle('#b71c1c')}
            >
              Reject All
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

      {/* Search bar */}
      <div style={{ marginBottom: '8px' }}>
        <input
          type="text"
          value={searchInput}
          onChange={e => { setSearchInput(e.target.value); if (!e.target.value) { setIdFilter(null); setSearchQuery(''); setPage(1); } }}
          onKeyDown={e => { if (e.key === 'Enter') { setIdFilter(null); setSearchQuery(searchInput); setPage(1); } }}
          placeholder="Search by title or description..."
          style={{
            width: '100%', padding: '8px 12px', fontSize: '0.88rem',
            border: '1px solid #d0d0d0', borderRadius: '6px', boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Filter rows — stacked: Types, Sources, Status */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
        {/* Row 1: Type filters */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {[
            { label: 'All Types', value: null },
            { label: 'News', value: 'news' },
            { label: 'Events', value: 'event' },
            { label: 'Photos', value: 'photo' },
          ].map(f => (
            <button key={f.label} onClick={() => { setFilter(f.value); setPage(1); }}
              style={filterBtn(filter === f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        {/* Row 2: Source filters */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {[
            { label: 'All Sources', value: null },
            { label: 'AI', value: 'ai' },
            { label: 'Human', value: 'human' },
            { label: 'Newsletter', value: 'newsletter' },
          ].map(f => (
            <button key={`src-${f.label}`} onClick={() => { setSourceFilter(f.value); setPage(1); }}
              style={filterBtn(sourceFilter === f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        {/* Row 3: Status filters */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {[
            { label: 'All', value: 'all' },
            { label: 'Pending', value: 'pending' },
            { label: 'Approved', value: 'approved' },
            { label: 'Rejected', value: 'rejected' },
          ].map(f => (
            <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(1); setSelectedItems(new Set()); }}
              style={filterBtn(statusFilter === f.value)}>
              {f.label}
            </button>
          ))}
        </div>
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
        <div className="park-news-list" style={{ gap: '6px' }}>
          {queue.map(item => {
            const itemKey = `${item.content_type}:${item.id}`;
            const isEditing = editingItem === itemKey;

            // Moderation extras: badges, triage chips, edit form, and action buttons
            // Rendered as children of the shared card component (below the card body, above nothing)
            const moderationExtras = (
              <>
                {/* Moderation badges — all on one line, wrapping when needed */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 8px' }}>
                  {/* Item ID badge */}
                  <span style={badgeStyle('#757575')}>#{item.id}</span>

                  {/* Content type badge */}
                  <span style={badgeStyle(getTypeBadgeColor(item.content_type))}>
                    {item.content_type}
                  </span>

                  {/* Source badge */}
                  {item.content_source && getSourceBadge(item.content_source) && (
                    <span style={badgeStyle(getSourceBadge(item.content_source).color)}>
                      {getSourceBadge(item.content_source).label}
                    </span>
                  )}

                  {/* Status badge (non-pending only) */}
                  {!isPending && (
                    <span style={badgeStyle(item.moderation_status === 'rejected' ? '#f44336' : '#4caf50')}>
                      {item.moderation_status === 'rejected' ? 'Rejected' : 'Approved'}
                    </span>
                  )}

                  {/* Additional URLs badge */}
                  {item.additional_url_count > 0 && (
                    <span style={badgeStyle('#1565c0')}>
                      +{item.additional_url_count} URL{item.additional_url_count > 1 ? 's' : ''}
                    </span>
                  )}

                  {/* Triage chips — inline with other badges */}
                  {item.content_type !== 'photo' && (() => {
                    const issues = item.ai_issues ? (() => { try { return JSON.parse(item.ai_issues); } catch { return []; } })() : [];
                    const urlIssueCodes = ['content_not_on_source_page', 'missing_source_url'];
                    const hasNoDate = item.content_type === 'event'
                      ? !item.publication_date && !item.start_date
                      : !item.publication_date || !item.date_consensus_score;
                    const hasUrlIssue = issues.some(i => urlIssueCodes.includes(i)) || (!item.source_url && item.content_type !== 'photo');
                    const urlLabel = !item.source_url ? 'No URL' : 'Wrong URL';
                    const hasOther = issues.some(i => !urlIssueCodes.includes(i));
                    return (
                      <>
                        {hasNoDate && <span style={badgeStyle('#e65100')}>No Date</span>}
                        {hasUrlIssue && <span style={badgeStyle('#e65100')}>{urlLabel}</span>}
                        {hasOther && <span style={badgeStyle('#b71c1c')}>Other</span>}
                      </>
                    );
                  })()}

                  {/* Confidence score */}
                  {item.confidence_score !== null && item.confidence_score !== undefined && (
                    <span style={{
                      color: getConfidenceColor(item.confidence_score),
                      fontWeight: 'bold', fontSize: '0.78rem'
                    }}>
                      {(item.confidence_score * 100).toFixed(0)}%
                    </span>
                  )}

                  {/* Collected / moderated timestamps */}
                  <span style={{ fontSize: '0.72rem', color: '#aaa' }}>
                    {formatPublicationDate(item.collection_date || item.created_at)}
                    {item.moderated_at && ` · Mod: ${formatPublicationDate(item.moderated_at)}`}
                  </span>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
                    padding: '12px', backgroundColor: '#fffbe6', borderRadius: '6px', border: '1px solid #ffe082' }}>
                    <div style={{ padding: '8px', backgroundColor: '#fff8e1', borderRadius: '4px',
                      fontSize: '0.8rem', color: '#555', lineHeight: '1.4', marginBottom: '4px' }}>
                      {item.ai_reasoning && (<><strong>AI Analysis:</strong> {item.ai_reasoning}<br/></>)}
                      <span style={{ fontSize: '0.75rem', color: '#888' }}>
                        Status: {item.moderation_status === 'auto_approved' ? 'Auto-approved by AI' :
                          item.moderation_status === 'published' ? 'Approved by human' :
                          item.moderation_status}
                        {item.confidence_score != null && ` · Score: ${(item.confidence_score * 100).toFixed(0)}%`}
                      </span>
                    </div>
                    {(FIELD_CONFIGS[item.content_type] || []).map(fc => (
                      <div key={fc.key}>
                        <label style={{ fontSize: '0.78rem', color: '#666', fontWeight: '500', marginBottom: '2px', display: 'block' }}>
                          {fc.label}
                        </label>
                        {renderFieldInput(fc, editFields, setEditFields)}
                      </div>
                    ))}
                    {/* Additional URLs management */}
                    {item.content_type !== 'photo' && (
                      <div>
                        <label style={{ fontSize: '0.78rem', color: '#666', fontWeight: '500', marginBottom: '2px', display: 'block' }}>
                          Additional URLs
                        </label>
                        {(itemUrls[itemKey] || []).map(u => (
                          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px',
                            padding: '4px 8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
                            <a href={u.url} target="_blank" rel="noopener noreferrer"
                              style={{ color: '#1976d2', flex: 1, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.url}
                            </a>
                            {u.source_name && <span style={{ color: '#888', fontSize: '0.7rem', flexShrink: 0 }}>({u.source_name})</span>}
                            <button onClick={() => handleRemoveUrl(item.content_type, item.id, u.id)}
                              style={{ background: 'none', border: 'none', color: '#f44336', cursor: 'pointer',
                                padding: '0 4px', fontSize: '0.85rem', flexShrink: 0, lineHeight: 1 }}
                              title="Remove URL">x</button>
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <input type="text" value={newUrlInput} onChange={e => setNewUrlInput(e.target.value)}
                            placeholder="Add another source URL..."
                            onKeyDown={e => e.key === 'Enter' && handleAddUrl(item.content_type, item.id)}
                            style={{ flex: 1, padding: '5px 8px', fontSize: '0.78rem', border: '1px solid #ccc', borderRadius: '4px' }} />
                          <button onClick={() => handleAddUrl(item.content_type, item.id)} disabled={addingUrl || !newUrlInput.trim()}
                            style={btnStyle(addingUrl || !newUrlInput.trim() ? '#ccc' : '#1976d2')}>
                            {addingUrl ? 'Adding...' : 'Add URL'}
                          </button>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <button onClick={() => handleSave(item.content_type, item.id)}
                        style={btnStyle('#4caf50')}>Save</button>
                      <button onClick={() => { setEditingItem(null); setEditFields({}); }}
                        style={btnStyle('transparent', '#666', '1px solid #ccc')}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {isPending && (
                    <input type="checkbox" checked={selectedItems.has(itemKey)}
                      onChange={() => toggleSelect(item.content_type, item.id)}
                      style={{ marginRight: '4px' }} />
                  )}
                  <button onClick={() => startEditing(item)}
                    style={actionBtn()}>Edit</button>
                  {item.content_type !== 'photo' && (
                    <button onClick={() => startMerge(item)}
                      style={actionBtn()}>Merge</button>
                  )}
                  {isPending && (
                    <>
                      <button onClick={() => handleApprove(item.content_type, item.id)}
                        style={actionBtn()}>Approve</button>
                      <button onClick={() => handleReject(item.content_type, item.id)}
                        style={actionBtn()}>Reject</button>
                    </>
                  )}
                  {!isPending && (
                    <>
                      <button onClick={() => handleReject(item.content_type, item.id)}
                        style={actionBtn()}>Reject</button>
                      <button onClick={() => handleRequeue(item.content_type, item.id)}
                        style={actionBtn()}>Requeue</button>
                    </>
                  )}
                  {item.content_type !== 'photo' && (
                    <button onClick={() => handleFixDate(item.content_type, item.id)}
                      disabled={fixingDateItem === itemKey}
                      style={actionBtn(fixingDateItem === itemKey)}>
                      {fixingDateItem === itemKey ? 'Finding...' : 'Fix Date'}
                    </button>
                  )}
                  {item.content_type !== 'photo' && (
                    confirmDelete === itemKey ? (
                      <>
                        <button onClick={() => handleDelete(item.content_type, item.id)}
                          style={{ ...actionBtn(), backgroundColor: '#ffebee', color: '#c62828', borderColor: '#ef9a9a', width: 'auto', padding: '4px 8px' }}>
                          Confirm Delete
                        </button>
                        <button onClick={() => setConfirmDelete(null)}
                          style={actionBtn()}>Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelete(itemKey)}
                        style={{ ...actionBtn(), backgroundColor: '#ffebee', color: '#c62828', borderColor: '#ef9a9a' }}>
                        Delete
                      </button>
                    )
                  )}
                </div>

                {/* Merge candidate selection */}
                {mergingItem && mergingItem.type === item.content_type && mergingItem.id === item.id && (
                  <div style={{ marginTop: '8px', padding: '10px', backgroundColor: '#e3f2fd',
                    borderRadius: '6px', border: '1px solid #90caf9' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 'bold', marginBottom: '6px', color: '#1565c0' }}>
                      Merge this item into (target keeps its title/summary):
                    </div>
                    {mergeCandidates.length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: '#666' }}>
                        {mergingItem ? 'Loading candidates...' : 'No other items found for this POI.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
                        {mergeCandidates.map(c => (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '6px 8px', backgroundColor: 'white', borderRadius: '4px',
                            border: '1px solid #e0e0e0' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
                                {c.title}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: '#888', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <span>#{c.id}</span>
                                <span>{c.moderation_status}</span>
                                {c.publication_date && <span>{new Date(c.publication_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>}
                                {c.additional_url_count > 0 && <span>+{c.additional_url_count} URLs</span>}
                              </div>
                              {c.source_url && (
                                <div style={{ fontSize: '0.68rem', color: '#1976d2', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {c.source_url}
                                </div>
                              )}
                            </div>
                            <button onClick={() => handleMerge(c.id)} disabled={merging}
                              style={{ ...actionBtn(merging), backgroundColor: merging ? '#ccc' : '#1565c0',
                                color: 'white', flexShrink: 0 }}>
                              {merging ? 'Merging...' : 'Merge Into'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => { setMergingItem(null); setMergeCandidates([]); }}
                      style={{ ...actionBtn(), marginTop: '6px', fontSize: '0.72rem' }}>Cancel</button>
                  </div>
                )}
              </>
            );

            // Render using shared card components based on content type
            if (item.content_type === 'news') {
              return (
                <NewsCardBody key={itemKey} item={{ ...item, summary: item.description }}
                  id={`moderation-item-${itemKey}`} onSelectPoi={onSelectPoi}>
                  {moderationExtras}
                </NewsCardBody>
              );
            } else if (item.content_type === 'event') {
              return (
                <EventCardBody key={itemKey} item={item}
                  id={`moderation-item-${itemKey}`} onSelectPoi={onSelectPoi}>
                  {moderationExtras}
                </EventCardBody>
              );
            } else {
              // Photo — keep simple inline rendering
              return (
                <div key={itemKey} id={`moderation-item-${itemKey}`} style={{
                  border: '1px solid #e0e0e0', borderRadius: '8px', padding: '10px 12px',
                  backgroundColor: 'white'
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: '0.92rem', marginBottom: '4px' }}>
                    {item.title || '(untitled)'}
                  </div>
                  {getThumbnailUrl(item) && (
                    <div
                      onClick={() => handleOpenLightbox(item)}
                      style={{
                        width: '120px', height: '90px', borderRadius: '6px',
                        overflow: 'hidden', cursor: 'pointer', margin: '6px 0',
                        border: '1px solid #e0e0e0', position: 'relative', flexShrink: 0
                      }}
                    >
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
                  {moderationExtras}
                </div>
              );
            }
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

      {/* Lightbox */}
      {lightboxMedia && (
        <Lightbox
          media={lightboxMedia}
          initialIndex={lightboxIndex}
          onClose={handleLightboxClose}
          poiId={lightboxPoiId}
          user={user}
          onMediaUpdate={handleMediaUpdate}
        />
      )}
    </div>
  );
}

export default ModerationInbox;
