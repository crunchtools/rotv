import { useState } from 'react';

/**
 * Holds a JSON list fetched from `url` plus its loading/error state. The
 * caller decides when to load by calling reload() (on mount, on refresh, after
 * an edit); a failed load keeps the previous items and sets `error`.
 *
 * @param {string} url - Endpoint returning a JSON array.
 * @param {string} errorMessage - User-facing text placed in `error` on failure.
 * @returns {{items: Array, loading: boolean, error: string|null, reload: () => Promise<void>}}
 */
export default function useFetchedList(url, errorMessage) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      setItems(await response.json());
    } catch (err) {
      console.error(`${errorMessage}:`, err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return { items, loading, error, reload };
}
