import React, { useState, useEffect, useCallback, useRef } from 'react';

const TOUR_STEPS = [
  {
    selector: '.leaflet-container',
    title: 'Interactive Map',
    description: 'Pan, zoom, and click any point of interest to explore Cuyahoga Valley\'s history.',
    position: 'center'
  },
  {
    selector: '.zoom-locate-control',
    title: 'Zoom In & Out',
    description: 'Use these controls to zoom the map and discover more detail.',
    position: 'right'
  },
  {
    selector: '.header-tabs .tab-btn:nth-child(2)',
    title: 'Browse Results',
    description: 'Results update as you zoom \u2014 see all points of interest in the current map view.',
    position: 'bottom',
    padding: 2
  },
  {
    selector: '.tab-btn:nth-child(3)',
    title: 'Park News',
    description: 'News updates with the map too \u2014 curated from local sources about the valley.',
    position: 'bottom',
    padding: 2
  },
  {
    selector: '.tab-btn:nth-child(4)',
    title: 'Upcoming Events',
    description: 'Events also follow the map \u2014 concerts, hikes, programs in your current view.',
    position: 'bottom',
    padding: 2
  },
  {
    selector: '.legend',
    title: 'POIs & Boundaries',
    description: 'Toggle point of interest types and boundary overlays to customize your view.',
    position: 'right'
  },
  {
    selector: '.sidebar-tabs .sidebar-tab',
    title: 'Explore a Place',
    description: 'When you click a POI, browse its Info, News, Events, History, and Associations.',
    position: 'left',
    action: 'selectVisitorCenter',
    delay: 400,
    spotlightSelector: '.sidebar-tabs'
  },
  {
    selector: '.tab-account-container',
    title: 'Sign In',
    description: 'Log in to access settings, edit mode, and personalization.',
    position: 'bottom-left',
    action: 'showMapView'
  },
  {
    selector: '.newsletter-form .save-settings-btn',
    title: 'Newsletter',
    description: 'Sign up for a weekly digest of news and events delivered to your inbox.',
    position: 'right',
    action: 'showNewsletter',
    delay: 100
  }
];

// Pure function — compute spotlight rect and tooltip position from a step and its DOM element
function computePosition(step, el) {
  if (!el) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      spotlightRect: null,
      tooltipStyle: { top: `${vh / 2 - 90}px`, left: `${vw / 2 - 150}px` }
    };
  }

  // Scroll into view if needed (only for non-map elements like settings forms)
  const elRect = el.getBoundingClientRect();
  const isOffScreen = elRect.top < 0 || elRect.bottom > window.innerHeight;
  const isInSettingsPanel = el.closest('.settings-content');
  if (isOffScreen && isInSettingsPanel) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
  }

  const rect = el.getBoundingClientRect();
  const padding = step.padding !== undefined ? step.padding : 8;
  const spotlight = {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2
  };

  if (step.position === 'center') {
    const cvw = window.innerWidth;
    const cvh = window.innerHeight;
    return {
      spotlightRect: spotlight,
      tooltipStyle: { top: `${cvh / 2 - 90}px`, left: `${cvw / 2 - 150}px` }
    };
  }

  const tooltipWidth = 300;
  const tooltipHeight = 180;
  const gap = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top, left;

  switch (step.position) {
    case 'bottom':
      top = spotlight.top + spotlight.height + gap;
      left = spotlight.left + spotlight.width / 2 - tooltipWidth / 2;
      break;
    case 'bottom-right':
      top = spotlight.top + spotlight.height + gap;
      left = Math.min(spotlight.left + spotlight.width / 2, vw - tooltipWidth - 20);
      break;
    case 'bottom-left':
      top = spotlight.top + spotlight.height + gap;
      left = Math.max(20, spotlight.left + spotlight.width / 2 - tooltipWidth);
      break;
    case 'top':
      top = spotlight.top - tooltipHeight - gap;
      left = spotlight.left + spotlight.width / 2 - tooltipWidth / 2;
      break;
    case 'left':
      top = spotlight.top + spotlight.height / 2 - tooltipHeight / 2;
      left = spotlight.left - tooltipWidth - gap;
      break;
    case 'right':
      top = spotlight.top + spotlight.height / 2 - tooltipHeight / 2;
      left = spotlight.left + spotlight.width + gap;
      break;
    default:
      top = spotlight.top + spotlight.height + gap;
      left = spotlight.left;
  }

  // Clamp to viewport
  if (top + tooltipHeight > vh - 20) {
    top = Math.min(spotlight.top + spotlight.height - tooltipHeight - gap, vh - tooltipHeight - 20);
    top = Math.max(20, top);
  }
  if (top < 20) top = 20;
  if (left + tooltipWidth > vw - 20) left = vw - tooltipWidth - 20;
  if (left < 20) left = 20;

  return { spotlightRect: spotlight, tooltipStyle: { top: `${top}px`, left: `${left}px` } };
}

function GuidedTour({ onEnd, currentStep, setCurrentStep, onStepAction }) {
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [stepReady, setStepReady] = useState(true);
  const resizeRef = useRef(null);
  const prevStepRef = useRef(-1);

  const step = TOUR_STEPS[currentStep];

  // Apply positioning from a step
  const applyPosition = useCallback((s) => {
    const spotlightEl = s.spotlightSelector ? document.querySelector(s.spotlightSelector) : null;
    const el = spotlightEl || document.querySelector(s.selector);
    const result = computePosition(s, el);
    setSpotlightRect(result.spotlightRect);
    setTooltipStyle(result.tooltipStyle);
  }, []);

  // Single effect for step transitions — handles actions, delays, and positioning
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    const timers = [];

    // Fire action on step entry (only once per step)
    if (prevStepRef.current !== currentStep) {
      prevStepRef.current = currentStep;

      if (step.action && onStepAction) {
        onStepAction(step.action);
      }
    }

    if (step.delay) {
      // Hide everything until element is found and layout is stable
      setStepReady(false);
      setSpotlightRect(null);

      // Poll until element appears and position is stable
      let retryCount = 0;
      let lastTop = null;
      let stableCount = 0;
      const poll = () => {
        if (cancelled) return;
        const targetSelector = step.spotlightSelector || step.selector;
        const el = document.querySelector(targetSelector);
        if (el) {
          const rect = el.getBoundingClientRect();
          // Wait until the element position is stable (not moving from animations)
          if (lastTop !== null && Math.abs(rect.top - lastTop) < 2) {
            stableCount++;
          } else {
            stableCount = 0;
          }
          lastTop = rect.top;
          if (stableCount >= 2) {
            applyPosition(step);
            setStepReady(true);
            return;
          }
          timers.push(setTimeout(poll, 80));
        } else if (retryCount < 30) {
          retryCount++;
          timers.push(setTimeout(poll, 50));
        } else {
          applyPosition(step);
          setStepReady(true);
        }
      };
      timers.push(setTimeout(poll, step.delay));
    } else {
      // Immediate positioning
      setStepReady(true);
      applyPosition(step);
    }

    // Resize handler
    const handleResize = () => {
      if (resizeRef.current) cancelAnimationFrame(resizeRef.current);
      resizeRef.current = requestAnimationFrame(() => applyPosition(step));
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      timers.forEach(t => clearTimeout(t));
      window.removeEventListener('resize', handleResize);
      if (resizeRef.current) cancelAnimationFrame(resizeRef.current);
    };
  }, [currentStep, step, onStepAction, applyPosition]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onEnd();
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (currentStep < TOUR_STEPS.length - 1) {
          setCurrentStep(currentStep + 1);
        } else {
          onEnd();
        }
      } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        setCurrentStep(currentStep - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, setCurrentStep, onEnd]);

  if (!step) return null;

  const isLastStep = currentStep === TOUR_STEPS.length - 1;

  return (
    <div className="guided-tour-overlay" aria-label="Guided tour" role="dialog">
      {spotlightRect && stepReady && (
        <div
          className="guided-tour-backdrop"
          style={{
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 0 2px rgba(255, 255, 255, 0.3) inset',
            position: 'fixed',
            top: `${spotlightRect.top}px`,
            left: `${spotlightRect.left}px`,
            width: `${spotlightRect.width}px`,
            height: `${spotlightRect.height}px`,
            borderRadius: '8px',
            pointerEvents: 'none',
            zIndex: 10002
          }}
        />
      )}
      {!spotlightRect && stepReady && (
        <div className="guided-tour-backdrop-full" />
      )}

      <div
        className={`guided-tour-tooltip ${stepReady ? 'tour-visible' : 'tour-hidden'}`}
        style={tooltipStyle}
        role="alertdialog"
        aria-label={step.title}
      >
        <div className="guided-tour-step-indicator">
          {currentStep + 1} of {TOUR_STEPS.length}
        </div>
        <h4 className="guided-tour-title">{step.title}</h4>
        <p className="guided-tour-description">{step.description}</p>
        <div className="guided-tour-actions">
          {currentStep > 0 && (
            <button className="guided-tour-btn guided-tour-back" onClick={() => setCurrentStep(currentStep - 1)}>
              Back
            </button>
          )}
          <button className="guided-tour-btn guided-tour-end" onClick={onEnd}>
            End Tour
          </button>
          {!isLastStep ? (
            <button className="guided-tour-btn guided-tour-next" onClick={() => setCurrentStep(currentStep + 1)}>
              Next
            </button>
          ) : (
            <button className="guided-tour-btn guided-tour-next" onClick={onEnd}>
              Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default GuidedTour;
