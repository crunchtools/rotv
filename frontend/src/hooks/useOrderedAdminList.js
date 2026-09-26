import { useState, useEffect, useCallback, useRef } from 'react';
import useDragReorder from './useDragReorder';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Shared CRUD + drag-to-reorder state for the admin taxonomy lists
 * (activities, eras, surfaces) served from /api/admin/<resource>.
 *
 * @param {string} endpoint - Collection URL; items live at `${endpoint}/:id`,
 *   order is saved to `${endpoint}/reorder`.
 * @param {string} noun - Singular name used in confirm and error messages.
 * @param {string} pluralNoun - Plural name used in load error messages.
 * @returns {{items: Array, loading: boolean, error: string|null, saving: boolean,
 *   createItem: (body: object) => Promise<boolean>,
 *   updateItem: (id: number, body: object) => Promise<boolean>,
 *   deleteItem: (id: number, name: string) => Promise<void>,
 *   saveOrder: (ordered: Array) => Promise<void>,
 *   dragProps: Function, dragClassName: Function}}
 *   Every failure is reported through `error` (server message when it sent one);
 *   create/update resolve false on failure and leave `items` unchanged.
 */
export default function useOrderedAdminList(endpoint, noun, pluralNoun) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Latest list for saveOrder's revert, which is memoised on endpoint only.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const loadItems = async () => {
      try {
        const response = await fetch(endpoint, { credentials: 'include' });
        if (response.ok) {
          setItems(await response.json());
          setError(null);
        } else {
          setError(`Failed to fetch ${pluralNoun}`);
        }
      } catch (err) {
        setError(`Failed to fetch ${pluralNoun}: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    loadItems();
  }, [endpoint, pluralNoun]);

  // Returns the saved row, or null once the failure is in `error`.
  const saveItem = async (url, method, body, failureMessage) => {
    setSaving(true);
    try {
      const response = await fetch(url, {
        method,
        headers: JSON_HEADERS,
        credentials: 'include',
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const failure = await response.json();
        setError(failure.error || failureMessage);
        return null;
      }
      setError(null);
      return await response.json();
    } catch (err) {
      setError(`${failureMessage}: ${err.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const createItem = async (body) => {
    const created = await saveItem(endpoint, 'POST', body, `Failed to add ${noun}`);
    if (created) setItems(prev => [...prev, created]);
    return Boolean(created);
  };

  const updateItem = async (id, body) => {
    const updated = await saveItem(`${endpoint}/${id}`, 'PUT', body, `Failed to update ${noun}`);
    if (updated) setItems(prev => prev.map(existing => existing.id === id ? updated : existing));
    return Boolean(updated);
  };

  const deleteItem = async (id, name) => {
    if (!confirm(`Delete ${noun} "${name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`${endpoint}/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (response.ok) {
        setItems(prev => prev.filter(existing => existing.id !== id));
        setError(null);
      } else {
        const failure = await response.json();
        setError(failure.error || `Failed to delete ${noun}`);
      }
    } catch (err) {
      setError(`Failed to delete ${noun}: ${err.message}`);
    }
  };

  const saveOrder = useCallback(async (ordered) => {
    const previous = itemsRef.current;
    setItems(ordered);
    // Show the new order immediately, but put the saved order back if the server rejects it.
    const revert = () => setItems(current => (current === ordered ? previous : current));
    try {
      const response = await fetch(`${endpoint}/reorder`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        credentials: 'include',
        body: JSON.stringify({ orderedIds: ordered.map(entry => entry.id) })
      });
      if (!response.ok) {
        revert();
        const failure = await response.json();
        setError(failure.error || 'Failed to save order');
      } else {
        setError(null);
      }
    } catch (err) {
      revert();
      setError(`Failed to save order: ${err.message}`);
    }
  }, [endpoint]);

  const { dragProps, dragClassName } = useDragReorder(items, saveOrder);

  return {
    items, loading, error, saving,
    createItem, updateItem, deleteItem, saveOrder,
    dragProps, dragClassName
  };
}
