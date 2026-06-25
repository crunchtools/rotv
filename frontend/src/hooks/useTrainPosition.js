import { useState, useEffect } from 'react';

const POLL_INTERVAL_MS = 5000;

export default function useTrainPosition() {
  const [trainPosition, setTrainPosition] = useState(null);

  useEffect(() => {
    let mounted = true;

    const fetchPosition = () => {
      fetch('/api/train/position')
        .then(res => res.json())
        .then(positions => {
          if (mounted) setTrainPosition(positions.cvsr || null);
        })
        .catch(() => {
          if (mounted) setTrainPosition(null);
        });
    };

    fetchPosition();
    const interval = setInterval(fetchPosition, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return trainPosition;
}
