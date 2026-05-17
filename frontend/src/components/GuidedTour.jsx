import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const TOUR_STEPS = [
  {
    selector: '.leaflet-container',
    title: 'Interactive Map',
    description: 'Pan, zoom, and click any point of interest to explore Cuyahoga Valley\'s history.',
    position: 'center',
    action: 'showMapView',
    delay: 300
  },
  {
    selector: '.zoom-locate-control',
    title: 'Zoom In & Out',
    description: 'Use these controls to zoom the map and discover more detail.',
    position: 'right',
    action: 'showMapView',
    delay: 300
  },
  {
    selector: '.header-tabs .tab-btn:nth-child(2)',
    title: 'Browse Results',
    description: 'Results update as you zoom \u2014 see all points of interest in the current map view.',
    position: 'bottom',
    padding: 2,
    action: 'showResults',
    delay: 300
  },
  {
    selector: '.results-subtab[data-subtab="mtb"]',
    title: 'MTB Trail Status',
    description: 'Switch to the MTB Trail Status view to see current mountain bike trail conditions.',
    position: 'bottom',
    padding: 2,
    action: 'showResults',
    delay: 300
  },
  {
    selector: '.tab-btn:nth-child(3)',
    title: 'Park News',
    description: 'News updates with the map too \u2014 curated from local sources about the valley.',
    position: 'bottom',
    padding: 2,
    action: 'showNews',
    delay: 300
  },
  {
    selector: '.tab-btn:nth-child(4)',
    title: 'Upcoming Events',
    description: 'Events also follow the map \u2014 concerts, hikes, programs in your current view.',
    position: 'bottom',
    padding: 2,
    action: 'showEvents',
    delay: 300
  },
  {
    selector: '.header-tabs .tab-btn:nth-child(5)',
    title: 'About',
    description: 'Learn the project story, revisit this tutorial, send feedback, or read the privacy policy.',
    position: 'bottom',
    padding: 2,
    action: 'showAbout',
    delay: 300
  },
  {
    selector: '.map-poi-count',
    title: 'Results',
    description: 'Tap the results chip to open the filter panel for POI types and boundaries.',
    position: 'bottom',
    action: 'showMapView',
    delay: 300,
    mobileOnly: true
  },
  {
    selector: '.legend',
    title: 'POIs & Boundaries',
    description: 'Toggle point of interest types and boundary overlays to customize your view.',
    position: 'right',
    action: 'showMapView',
    delay: 300,
    mobile: {
      selector: '.legend.legend-expanded',
      spotlightSelector: '.legend.legend-expanded',
      action: 'expandLegend',
      delay: 350
    }
  },
  {
    selector: '.sidebar-tabs .sidebar-tab',
    title: 'Explore a Place',
    description: 'When you click a POI, browse its Info, News, Events, History, and Associations.',
    position: 'left',
    action: 'selectVisitorCenter',
    delay: 400,
    spotlightSelector: '.sidebar-tabs',
    mobile: {
      action: 'collapseLegendThenSelectVisitorCenter',
      delay: 600
    }
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
    delay: 100,
    mobile: {
      delay: 400,
      position: 'top',
      mobilePositionAbove: true
    }
  }
];

function getEffectiveStep(step, isMobile) {
  if (!step || !isMobile || !step.mobile) return step;
  return { ...step, ...step.mobile };
}

function getActiveSteps(isMobile) {
  return TOUR_STEPS.filter(s => {
    if (s.mobileOnly && !isMobile) return false;
    if (s.desktopOnly && isMobile) return false;
    return true;
  });
}

function rectsOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

function placeTooltip(placement, spotlight, tooltipWidth, tooltipHeight, gap, vw, vh) {
  let top, left;
  switch (placement) {
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

  if (top + tooltipHeight > vh - 20) top = vh - tooltipHeight - 20;
  if (top < 20) top = 20;
  if (left + tooltipWidth > vw - 20) left = vw - tooltipWidth - 20;
  if (left < 20) left = 20;

  const tooltipRect = { top, left, right: left + tooltipWidth, bottom: top + tooltipHeight };
  const spotRect = {
    top: spotlight.top,
    left: spotlight.left,
    right: spotlight.left + spotlight.width,
    bottom: spotlight.top + spotlight.height
  };
  const overlaps = rectsOverlap(tooltipRect, spotRect);

  return { top, left, overlaps };
}

function computePosition(step, el, isMobile) {
  const isHidden = el && (el.offsetParent === null || (el.getBoundingClientRect().width === 0 && el.getBoundingClientRect().height === 0));
  if (!el || isHidden) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      spotlightRect: null,
      tooltipStyle: { top: `${vh / 2 - 90}px`, left: `${vw / 2 - 150}px` },
      mobilePositionAbove: false
    };
  }

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

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (step.position === 'center') {
    return {
      spotlightRect: spotlight,
      tooltipStyle: { top: `${vh / 2 - 90}px`, left: `${vw / 2 - 150}px` },
      mobilePositionAbove: false
    };
  }

  const tooltipWidth = isMobile ? Math.min(300, vw - 40) : 300;
  const tooltipHeight = isMobile ? 220 : 180;
  const gap = 16;

  if (isMobile) {
    const bottomDocked = {
      top: vh - tooltipHeight - 20,
      left: 20,
      right: vw - 20,
      bottom: vh - 20
    };
    const spotRect = {
      top: spotlight.top,
      left: spotlight.left,
      right: spotlight.left + spotlight.width,
      bottom: spotlight.top + spotlight.height
    };
    const autoCollides = rectsOverlap(bottomDocked, spotRect);
    const topAboveRaw = spotlight.top - tooltipHeight - gap;
    const fitsAbove = topAboveRaw >= 20;

    let useAbove = !!step.mobilePositionAbove;
    if (autoCollides && !useAbove && fitsAbove) {
      useAbove = true;
    }

    if (useAbove) {
      const topAbove = Math.max(20, topAboveRaw);
      return {
        spotlightRect: spotlight,
        tooltipStyle: { top: `${topAbove}px`, left: `${vw / 2 - tooltipWidth / 2}px` },
        mobilePositionAbove: true
      };
    }
    return {
      spotlightRect: spotlight,
      tooltipStyle: { top: `${vh - tooltipHeight - 20}px`, left: `${vw / 2 - tooltipWidth / 2}px` },
      mobilePositionAbove: false
    };
  }

  const tried = new Set();
  const placements = [step.position, 'bottom', 'top', 'right', 'left'];
  let chosen = null;
  let firstAttempt = null;
  for (const p of placements) {
    if (tried.has(p)) continue;
    tried.add(p);
    const candidate = placeTooltip(p, spotlight, tooltipWidth, tooltipHeight, gap, vw, vh);
    if (!firstAttempt) firstAttempt = candidate;
    if (!candidate.overlaps) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) chosen = firstAttempt;

  return {
    spotlightRect: spotlight,
    tooltipStyle: { top: `${chosen.top}px`, left: `${chosen.left}px` },
    mobilePositionAbove: false
  };
}

function GuidedTour({ onEnd, currentStep, setCurrentStep, onStepAction }) {
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState({});
  const [stepReady, setStepReady] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [mobilePositionAbove, setMobilePositionAbove] = useState(false);
  const resizeRef = useRef(null);
  const prevStepRef = useRef(-1);

  const activeSteps = useMemo(() => getActiveSteps(isMobile), [isMobile]);
  const baseStep = activeSteps[currentStep];
  const step = useMemo(() => getEffectiveStep(baseStep, isMobile), [baseStep, isMobile]);

  const applyPosition = useCallback((s) => {
    const spotlightEl = s.spotlightSelector ? document.querySelector(s.spotlightSelector) : null;
    const el = spotlightEl || document.querySelector(s.selector);
    const result = computePosition(s, el, isMobile);
    setSpotlightRect(result.spotlightRect);
    setTooltipStyle(result.tooltipStyle);
    setMobilePositionAbove(result.mobilePositionAbove);
  }, [isMobile]);

  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    const timers = [];

    if (prevStepRef.current !== currentStep) {
      prevStepRef.current = currentStep;

      if (step.action && onStepAction) {
        onStepAction(step.action);
      }
    }

    if (step.delay) {
      setStepReady(false);
      setSpotlightRect(null);

      let retryCount = 0;
      let lastTop = null;
      let stableCount = 0;
      const poll = () => {
        if (cancelled) return;
        const targetSelector = step.spotlightSelector || step.selector;
        const el = document.querySelector(targetSelector);
        if (el) {
          const rect = el.getBoundingClientRect();
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
      setStepReady(true);
      applyPosition(step);
    }

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (resizeRef.current) cancelAnimationFrame(resizeRef.current);
      resizeRef.current = requestAnimationFrame(() => applyPosition(step));
    };
    window.addEventListener('resize', handleResize);

    const handleScroll = () => {
      if (resizeRef.current) cancelAnimationFrame(resizeRef.current);
      resizeRef.current = requestAnimationFrame(() => applyPosition(step));
    };
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });

    const repositionInterval = setInterval(() => {
      if (!cancelled) applyPosition(step);
    }, 250);

    return () => {
      cancelled = true;
      timers.forEach(t => clearTimeout(t));
      clearInterval(repositionInterval);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, { capture: true });
      if (resizeRef.current) cancelAnimationFrame(resizeRef.current);
    };
  }, [currentStep, step, onStepAction, applyPosition, isMobile]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onEnd();
      } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (currentStep < activeSteps.length - 1) {
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
  }, [currentStep, setCurrentStep, onEnd, activeSteps.length]);

  if (!step) return null;

  const isLastStep = currentStep === activeSteps.length - 1;

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
        className={`guided-tour-tooltip ${stepReady ? 'tour-visible' : 'tour-hidden'} ${isMobile && mobilePositionAbove ? 'tour-position-above' : ''}`}
        style={{ ...tooltipStyle, '--tour-top': tooltipStyle.top }}
        role="alertdialog"
        aria-label={step.title}
      >
        <div className="guided-tour-step-indicator">
          {currentStep + 1} of {activeSteps.length}
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
