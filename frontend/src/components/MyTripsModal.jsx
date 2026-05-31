import React from 'react';
import TripsManager from './TripsManager';
import './MyTripsModal.css';

export default function MyTripsModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="my-trips-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="my-trips-modal" onClick={(e) => e.stopPropagation()}>
        <div className="my-trips-header">
          <h2>My Trips</h2>
          <button className="my-trips-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="my-trips-body">
          <TripsManager active={open} onClosed={onClose} />
        </div>
      </div>
    </div>
  );
}
