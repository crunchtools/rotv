import { useState, useEffect, useRef, useCallback } from 'react';

// Shared POI media state for the sidebar (spec 019). Loads the mosaic/all-media
// for a POI, refreshes on the global `poi-media-updated` event, and exposes a
// manual refresh. Works identically for every POI type (point, trail, river,
// boundary, organization) — the old sidebar only refreshed the POI object for
// destinations, which is the linear-feature media bug called out in issue #184.
export default function usePoiMedia(poi, onPoiUpdate) {
  const [media, setMedia] = useState([]);
  const [allMedia, setAllMedia] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const poiId = poi?.id;

  // Keep the latest callback in a ref so effects depend only on poiId.
  const onPoiUpdateRef = useRef(onPoiUpdate);
  useEffect(() => {
    onPoiUpdateRef.current = onPoiUpdate;
  });

  useEffect(() => {
    if (!poiId) return;

    setMediaLoading(true);
    fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : { mosaic: [], all_media: [] })
      .then(data => {
        setMedia(data.mosaic || []);
        setAllMedia(data.all_media || []);
        setMediaLoading(false);
      })
      .catch(err => {
        console.error('Failed to load media:', err);
        setMedia([]);
        setAllMedia([]);
        setMediaLoading(false);
      });
  }, [poiId]);

  useEffect(() => {
    if (!poiId) return;

    const handleMediaUpdateEvent = (event) => {
      if (event.detail.poiId === poiId) {
        console.log('[Sidebar] POI media updated for', poiId, '- refreshing...');
        fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            setMedia(data.mosaic || []);
            setAllMedia(data.all_media || []);
          })
          .catch(err => console.error('[Sidebar] Failed to refresh media:', err));

        fetch(`/api/pois/${poiId}`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            if (onPoiUpdateRef.current) onPoiUpdateRef.current(data);
          })
          .catch(err => console.error('[Sidebar] Failed to refresh POI:', err));
      }
    };

    window.addEventListener('poi-media-updated', handleMediaUpdateEvent);
    return () => window.removeEventListener('poi-media-updated', handleMediaUpdateEvent);
  }, [poiId]);

  const refreshMedia = useCallback(() => {
    if (!poiId) return;

    fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        setMedia(data.mosaic || []);
        setAllMedia(data.all_media || []);
      })
      .catch(err => console.error('Failed to refresh media:', err));

    if (onPoiUpdateRef.current) {
      fetch(`/api/pois/${poiId}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => onPoiUpdateRef.current(data))
        .catch(err => console.error('Failed to refresh POI:', err));
    }

    window.dispatchEvent(new CustomEvent('moderation-count-changed'));
  }, [poiId]);

  return { media, allMedia, mediaLoading, refreshMedia };
}
