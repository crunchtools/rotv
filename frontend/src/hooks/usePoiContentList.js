import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Per-POI news or events list for the sidebar: load, admin "collect" (which
 * hands off to the jobs page), and admin delete.
 *
 * @param {object} options
 * @param {number|string} options.poiId - POI whose items to load; nothing loads while falsy.
 * @param {'news'|'events'} options.kind - Picks the /api/admin/<kind> endpoints.
 * @param {string} options.listUrl - Public URL that returns the item array.
 * @param {(count: number) => void} [options.onCountChange] - Called after each successful load.
 * @returns {{items: Array, loading: boolean, deleting: number|null, collecting: boolean,
 *   error: string|null, handleCollect: () => Promise<void>, handleDelete: (id: number) => Promise<void>}}
 *   Load and delete failures land in `error`; a failed collect alerts and re-enables the button,
 *   a successful one navigates to the jobs page.
 */
export default function usePoiContentList({ poiId, kind, listUrl, onCountChange }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState(null);

  const fetchItems = async () => {
    if (!poiId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(listUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const list = await response.json();
      setItems(list);
      if (onCountChange) onCountChange(list.length);
    } catch (err) {
      console.error(`Error fetching POI ${kind}:`, err);
      setError(`Failed to load ${kind}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiId, listUrl]); // fetchItems/onCountChange excluded — both are new every render; listUrl already encodes poiId and tz

  const handleCollect = async () => {
    if (!poiId) return;
    setCollecting(true);

    try {
      const timezone = localStorage.getItem('app-timezone') || 'America/New_York';
      const response = await fetch(`/api/admin/pois/${poiId}/${kind}/collect`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone })
      });

      if (response.ok) {
        const job = await response.json();
        navigate(`/admin/jobs?job=${job.jobId}&type=${job.jobType}&poi=${job.poiId || job.jobId}`);
      } else {
        const failure = await response.json();
        alert(`Collection failed: ${failure.error || 'Unknown error'}`);
        setCollecting(false);
      }
    } catch (err) {
      alert(`Collection failed: ${err.message}`);
      setCollecting(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const response = await fetch(`/api/admin/${kind}/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setItems(prev => prev.filter(existing => existing.id !== id));
    } catch (err) {
      setError(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  return { items, loading, deleting, collecting, error, handleCollect, handleDelete };
}
