import { useState, useEffect, useRef, useCallback } from 'react';

// Shared POI media for the sidebar: load, refresh on `poi-media-updated`, and a
// manual refresh. Refreshes the POI object for every type, not just points,
// fixing the linear-feature media bug in #184.
export default function usePoiMedia(poi, onPoiUpdate) {
  const [media, setMedia] = useState([]);
  const [allMedia, setAllMedia] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const poiId = poi?.id;

  const onPoiUpdateRef = useRef(onPoiUpdate);
  useEffect(() => {
    onPoiUpdateRef.current = onPoiUpdate;
  });

  useEffect(() => {
    // Clear the previous POI's media immediately so we never flash a stale
    // image while the newly selected POI's media is still loading.
    setMedia([]);
    setAllMedia([]);

    if (!poiId) return;

    let cancelled = false;
    setMediaLoading(true);
    fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : { mosaic: [], all_media: [] })
      .then(mediaResponse => {
        if (cancelled) return; // Ignore a response that lands after the POI changed
        setMedia(mediaResponse.mosaic || []);
        setAllMedia(mediaResponse.all_media || []);
        setMediaLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load media:', err);
        setMedia([]);
        setAllMedia([]);
        setMediaLoading(false);
      });

    return () => { cancelled = true; };
  }, [poiId]);

  useEffect(() => {
    if (!poiId) return;

    const handleMediaUpdateEvent = (event) => {
      if (event.detail.poiId === poiId) {
        console.log('[Sidebar] POI media updated for', poiId, '- refreshing...');
        fetch(`/api/pois/${poiId}/media`, { credentials: 'include' })
          .then(res => res.json())
          .then(mediaResponse => {
            setMedia(mediaResponse.mosaic || []);
            setAllMedia(mediaResponse.all_media || []);
          })
          .catch(err => console.error('[Sidebar] Failed to refresh media:', err));

        fetch(`/api/pois/${poiId}`, { credentials: 'include' })
          .then(res => res.json())
          .then(updatedPoi => {
            if (onPoiUpdateRef.current) onPoiUpdateRef.current(updatedPoi);
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
      .then(mediaResponse => {
        setMedia(mediaResponse.mosaic || []);
        setAllMedia(mediaResponse.all_media || []);
      })
      .catch(err => console.error('Failed to refresh media:', err));

    if (onPoiUpdateRef.current) {
      fetch(`/api/pois/${poiId}`, { credentials: 'include' })
        .then(res => res.json())
        .then(updatedPoi => onPoiUpdateRef.current(updatedPoi))
        .catch(err => console.error('Failed to refresh POI:', err));
    }

    window.dispatchEvent(new CustomEvent('moderation-count-changed'));
  }, [poiId]);

  return { media, allMedia, mediaLoading, refreshMedia };
}
