import usePolledPosition from './usePolledPosition';

const POLL_INTERVAL_MS = 5000;

export default function useTrainPosition() {
  return usePolledPosition('/api/train/position', 'cvsr', POLL_INTERVAL_MS);
}
