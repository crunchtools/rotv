import React from 'react';

function TourPrompt({ onStartTour, onDismiss }) {
  return (
    <div className="tour-prompt-overlay">
      <div className="tour-prompt-modal">
        <h3>Welcome to Roots of The Valley!</h3>
        <p>
          Would you like a quick tour to learn how the app works?
        </p>
        <div className="tour-prompt-actions">
          <button className="tour-prompt-btn tour-prompt-start" onClick={onStartTour}>
            Take a Tour
          </button>
          <button className="tour-prompt-btn tour-prompt-skip" onClick={onDismiss}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

export default TourPrompt;
