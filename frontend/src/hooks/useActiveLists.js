import { useEffect, useState } from 'react';

// One request for the whole app: the Find tab, the place card and the seasonal
// spotlight all ask which curated lists are in season (spec 050).
let activeListsRequest = null;

/**
 * The curated lists in season today.
 * @returns {object[]} Empty until loaded, and when none is in season
 */
export function useActiveLists() {
  const [lists, setLists] = useState([]);
  useEffect(() => {
    let current = true;
    if (!activeListsRequest) {
      activeListsRequest = fetch('/api/lists')
        .then(res => (res.ok ? res.json() : []))
        .catch(err => {
          console.error('Failed to fetch curated lists:', err);
          activeListsRequest = null;
          return [];
        });
    }
    activeListsRequest.then(loaded => { if (current) setLists(loaded); });
    return () => { current = false; };
  }, []);
  return lists;
}
