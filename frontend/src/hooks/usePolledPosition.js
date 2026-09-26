import { useState, useEffect } from 'react';

/**
 * Poll a live-position endpoint and return one tracker's entry from the response.
 *
 * @param {string} url - Endpoint returning an object keyed by tracker.
 * @param {string} trackerKey - Key of the tracker to return.
 * @param {number} intervalMs - Poll period.
 * @returns {object|null} The tracker's entry; null until the first reply or while polls fail.
 */
export default function usePolledPosition(url, trackerKey, intervalMs) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    let mounted = true;

    const fetchPosition = () => {
      fetch(url)
        .then(res => res.json())
        .then(positions => {
          if (mounted) setPosition(positions[trackerKey] || null);
        })
        .catch(err => {
          console.warn(`Position poll of ${url} failed:`, err);
          if (mounted) setPosition(null);
        });
    };

    fetchPosition();
    const interval = setInterval(fetchPosition, intervalMs);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [url, trackerKey, intervalMs]);

  return position;
}
