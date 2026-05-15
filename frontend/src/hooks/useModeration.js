import { useState, useEffect, useCallback } from 'react';

/**
 * Shared hook for per-item moderation state and API handlers.
 * Used by both ModerationInbox and ParkNews/ParkEvents.
 *
 * @param {Object} options
 * @param {Function} options.onItemsChanged - Callback to re-fetch items after mutations
 * @param {Function} options.onCountChange - Callback when pending count changes (optional)
 */
export default function useModeration({ onItemsChanged, onCountChange } = {}) {
  const [editingItem, setEditingItem] = useState(null); // "news:123" key
  const [editFields, setEditFields] = useState({});
  const [notification, setNotification] = useState(null);
  const [pois, setPois] = useState([]);
  const [itemUrls, setItemUrls] = useState({});
  const [newUrlInput, setNewUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [iaDateItem, setIaDateItem] = useState(null);
  const [mergingItem, setMergingItem] = useState(null);
  const [mergeCandidates, setMergeCandidates] = useState([]);
  const [merging, setMerging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selectedItems, setSelectedItems] = useState(new Set());

  const notify = useCallback((type, message) => setNotification({ type, message }), []);

  // Auto-dismiss notifications
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  // Fetch POIs for PoiSearchSelect
  useEffect(() => {
    fetch('/api/pois', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setPois(Array.isArray(data) ? data : []))
      .catch(() => setPois([]));
  }, []);

  const refreshItems = useCallback(() => {
    if (onItemsChanged) onItemsChanged();
  }, [onItemsChanged]);

  const handleApprove = async (type, id, item) => {
    try {
      const response = await fetch('/api/admin/moderation/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) {
        notify('success', `${type} #${id} approved`);
        refreshItems();
        if (onCountChange) onCountChange();
        if (type === 'photo' && item?.poi_id) {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: item.poi_id } }));
          window.dispatchEvent(new CustomEvent('poi-updated', { detail: { poiId: item.poi_id } }));
        }
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleReject = async (type, id, item) => {
    try {
      const response = await fetch('/api/admin/moderation/reject', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id, reason: '' })
      });
      if (response.ok) {
        notify('success', `${type} #${id} rejected`);
        refreshItems();
        if (onCountChange) onCountChange();
        if (type === 'photo' && item?.poi_id) {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: item.poi_id } }));
        }
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleRequeue = async (type, id) => {
    try {
      const response = await fetch('/api/admin/moderation/requeue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id })
      });
      if (response.ok) {
        notify('success', `${type} #${id} requeued`);
        refreshItems();
        if (onCountChange) onCountChange();
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleDelete = async (type, id) => {
    const endpoint = type === 'news' ? `/api/admin/news/${id}` : `/api/admin/events/${id}`;
    try {
      const response = await fetch(endpoint, { method: 'DELETE', credentials: 'include' });
      if (response.ok) {
        setConfirmDelete(null);
        notify('success', `${type} #${id} deleted`);
        refreshItems();
        if (onCountChange) onCountChange();
      } else {
        notify('error', `Failed to delete ${type} #${id}`);
      }
    } catch (err) { notify('error', err.message); }
  };

  const handleIaDate = async (type, id, sourceUrl) => {
    const itemKey = `${type}:${id}`;
    if (!sourceUrl) { notify('error', 'No source URL for this item'); return; }
    setIaDateItem(itemKey);
    try {
      const response = await fetch(`/api/admin/moderation/ia-date?url=${encodeURIComponent(sourceUrl)}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.date) {
          const saveResponse = await fetch('/api/admin/moderation/save', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include', body: JSON.stringify({ type, id, edits: { publication_date: data.date } })
          });
          if (saveResponse.ok) {
            notify('success', `${type} #${id} — date set to ${data.date} (earliest IA snapshot)`);
            refreshItems();
          } else {
            notify('error', 'IA date found but failed to update item');
          }
        } else {
          notify('error', 'No Internet Archive snapshots found for this URL');
        }
      } else {
        const err = await response.json();
        notify('error', err.error || 'IA Date lookup failed');
      }
    } catch (err) { notify('error', err.message); }
    finally { setIaDateItem(null); }
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
        if (item.content_type !== 'photo') {
          setItemUrls(prev => ({ ...prev, [itemKey]: detail.additional_urls || [] }));
        }
      }
    } catch (err) {
      notify('error', 'Failed to load item details');
    }
  };

  const cancelEditing = () => {
    setEditingItem(null);
    setEditFields({});
  };

  const handleSave = async (type, id, item) => {
    try {
      const response = await fetch('/api/admin/moderation/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ type, id, edits: editFields })
      });
      if (response.ok) {
        notify('success', `${type} #${id} saved`);
        setEditingItem(null);
        setEditFields({});
        refreshItems();
        if (type === 'photo' && item?.poi_id) {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: item.poi_id } }));
          if (editFields.poi_id && editFields.poi_id !== item.poi_id) {
            window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId: editFields.poi_id } }));
          }
        }
      } else {
        const err = await response.json();
        notify('error', err.error || 'Save failed');
      }
    } catch (err) { notify('error', err.message); }
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
          refreshItems();
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
        refreshItems();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Failed to remove URL');
      }
    } catch (err) { notify('error', err.message); }
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
        refreshItems();
      } else {
        const err = await response.json();
        notify('error', err.error || 'Merge failed');
      }
    } catch (err) { notify('error', err.message); }
    finally { setMerging(false); }
  };

  const cancelMerge = () => {
    setMergingItem(null);
    setMergeCandidates([]);
  };

  const handleBulkApprove = async (queue) => {
    if (selectedItems.size === 0) return;
    const items = Array.from(selectedItems).map(key => {
      const [type, id] = key.split(':');
      return { type, id: parseInt(id) };
    });
    const photoPoiIds = new Set();
    items.forEach(({ type, id }) => {
      if (type === 'photo') {
        const item = queue?.find(q => q.content_type === type && q.id === id);
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
        refreshItems();
        if (onCountChange) onCountChange();
        photoPoiIds.forEach(poiId => {
          window.dispatchEvent(new CustomEvent('poi-media-updated', { detail: { poiId } }));
        });
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

  const selectAll = (queue) => {
    if (selectedItems.size === queue.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(queue.map(item => `${item.content_type}:${item.id}`)));
    }
  };

  return {
    // State
    editingItem, editFields, setEditFields,
    notification, pois,
    itemUrls, newUrlInput, setNewUrlInput, addingUrl,
    iaDateItem,
    mergingItem, mergeCandidates, merging,
    confirmDelete, setConfirmDelete,
    selectedItems,
    // Handlers
    notify,
    handleApprove, handleReject, handleRequeue, handleDelete,
    handleSave, handleIaDate,
    startEditing, cancelEditing,
    startMerge, handleMerge, cancelMerge,
    handleAddUrl, handleRemoveUrl,
    handleBulkApprove, toggleSelect, selectAll
  };
}

// Re-export FIELD_CONFIGS so both ModerationExtras and ModerationInbox can use it
export const FIELD_CONFIGS = {
  news: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'summary', label: 'Summary', type: 'textarea' },
    { key: 'source_name', label: 'Source Name', type: 'text' },
    { key: 'news_type', label: 'Type', type: 'select', options: ['general', 'closure', 'seasonal', 'maintenance', 'wildlife'] },
    { key: 'publication_date', label: 'Publication Date', type: 'datetime-local' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
    { key: 'source_url', label: 'Primary URL', type: 'text' },
  ],
  event: [
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'start_date', label: 'Start Date/Time', type: 'datetime-local', required: true },
    { key: 'end_date', label: 'End Date/Time', type: 'datetime-local' },
    { key: 'event_type', label: 'Event Type', type: 'text' },
    { key: 'location_details', label: 'Location Details', type: 'text' },
    { key: 'publication_date', label: 'Publication Date', type: 'datetime-local' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
    { key: 'source_url', label: 'Primary URL', type: 'text' },
  ],
  photo: [
    { key: 'caption', label: 'Caption', type: 'textarea' },
    { key: 'poi_id', label: 'POI', type: 'poi' },
  ]
};
