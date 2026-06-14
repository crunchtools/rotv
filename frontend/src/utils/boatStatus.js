/**
 * Map a live boat position's status to a display label + CSS modifier class.
 * Shared by the map tooltip (Map.jsx) and the sidebar badge (ReadOnlyView.jsx)
 * so the two stay in sync (#035).
 * @param {{status?: string}|null} boatPosition
 * @returns {{label: string, className: string}}
 */
export function getBoatStatus(boatPosition) {
  if (boatPosition?.status === 'active') return { label: 'Live', className: 'live' };
  if (boatPosition?.status === 'docked') return { label: 'Docked', className: 'docked' };
  return { label: 'Offline', className: 'offline' };
}
