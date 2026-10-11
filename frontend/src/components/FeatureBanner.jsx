import React, { useEffect, useRef, useState } from 'react';
import { useFeatureSlides } from '../hooks/useFeatureSlides';

const ROTATE_MS = 7000;

// How far a finger must travel sideways, in pixels, to count as a swipe rather than a tap.
const SWIPE_PX = 40;

/**
 * The rotating banner in the header of Find and Happening: one other part of the site at a time,
 * each a way in. It is dark, photographic and labelled with where a tap goes,
 * so it reads as a door to somewhere else rather than as part of the list. It rotates on its own unless the person has asked for less
 * motion, is pointing at it, or has picked a slide themselves. A sideways
 * swipe moves to the next or previous one.
 *
 * @param {object} props
 * @param {object[]} props.destinations Every point POI
 * @param {object[]} [props.routes] Every river, railroad and water taxi
 * @param {string} [props.exclude] The id of a feature to leave out: the page the banner is already on
 * @returns {JSX.Element|null} Nothing when there is no other feature to show
 */
export default function FeatureBanner({ destinations, routes, exclude }) {
  const { slides: everySlide, open } = useFeatureSlides(destinations, routes);
  const slides = everySlide.filter(each => each.id !== exclude);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failedImages, setFailedImages] = useState(() => new Set());

  const shown = slides.length > 0 ? index % slides.length : 0;
  const slide = slides[shown];

  useEffect(() => {
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (paused || calm || slides.length < 2) return undefined;
    const timer = setInterval(() => setIndex(current => current + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, slides.length]);

  // Where a touch began, and whether it became a swipe: a swipe must not also open the slide.
  const touchStart = useRef(null);
  const swiped = useRef(false);

  const onTouchStart = (event) => {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
    swiped.current = false;
  };

  const onTouchEnd = (event) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || slides.length < 2) return;
    const touch = event.changedTouches[0];
    const across = touch.clientX - start.x;
    if (Math.abs(across) < SWIPE_PX || Math.abs(across) < Math.abs(touch.clientY - start.y)) return;
    swiped.current = true;
    // Only the click that this touch itself produces is swallowed.
    setTimeout(() => { swiped.current = false; }, 400);
    setIndex(shown + (across < 0 ? 1 : slides.length - 1));
    setPaused(true);
  };

  if (!slide) return null;

  const image = slide.images.find(url => !failedImages.has(url)) || null;
  const hasImage = Boolean(image);

  // A photo that already carries the feature's name is shown whole, with only the tally and the way in under it.
  const titled = hasImage && Boolean(slide.imageHasTitle);

  return (
    <section
      className="feature-banner"
      aria-roledescription="carousel"
      aria-label="More to do on Roots of The Valley"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <button
        type="button"
        key={slide.id}
        className={`feature-banner-slide ${hasImage ? '' : 'plain'} ${titled ? 'titled' : ''}`}
        onClick={() => { if (!swiped.current) open(slide); }}
      >
        {hasImage && (
          <img
            className="feature-banner-photo"
            src={image}
            alt=""
            onError={() => setFailedImages(failed => new Set(failed).add(image))}
          />
        )}
        <span className="feature-banner-scrim" aria-hidden="true" />
        <span className="feature-banner-copy">
          <span className={`feature-banner-kicker ${titled ? 'visually-hidden' : ''}`}>Also on Roots of The Valley</span>
          <span className={`feature-banner-title ${titled ? 'visually-hidden' : ''}`}>{slide.title}</span>
          <span className="feature-banner-text">{slide.text}</span>
        </span>
        <span className="feature-banner-cta">
          {slide.cta}
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M12 4l-1.410 1.410L16.170 11H4v2h12.170l-5.580 5.590L12 20l8-8z" />
          </svg>
        </span>
      </button>
      {slides.length > 1 && (
        <div className="feature-banner-dots">
          {slides.map((each, position) => (
            <button
              key={each.id}
              type="button"
              className={`feature-banner-dot ${position === shown ? 'active' : ''}`}
              aria-label={`Show ${each.title}`}
              aria-current={position === shown}
              onClick={() => { setIndex(position); setPaused(true); }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
