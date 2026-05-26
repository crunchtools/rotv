import { useState, useEffect } from 'react';

const POLL_INTERVAL_MS = 10000;

export default function useBoatPosition() {
  const [boatPosition, setBoatPosition] = useState(null);

  useEffect(() => {
    let mounted = true;

    const fetchPosition = () => {
      fetch('/api/water-taxi/position')
        .then(res => res.json())
        .then(positions => {
          if (mounted) setBoatPosition(positions.harbor_hopper || null);
        })
        .catch(() => {
          if (mounted) setBoatPosition(null);
        });
    };

    fetchPosition();
    const interval = setInterval(fetchPosition, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return boatPosition;
}
