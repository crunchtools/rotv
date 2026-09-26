import usePolledPosition from './usePolledPosition';

const POLL_INTERVAL_MS = 10000;

export default function useBoatPosition() {
  return usePolledPosition('/api/water-taxi/position', 'harbor_hopper', POLL_INTERVAL_MS);
}
