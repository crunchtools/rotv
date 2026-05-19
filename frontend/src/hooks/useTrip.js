import { useContext } from 'react';
import { TripContext } from '../contexts/TripContext';

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used within a TripProvider');
  return ctx;
}
