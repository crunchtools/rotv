import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useActiveLists } from '../hooks/useActiveLists';
import { listProgress, formatListDay } from '../utils/listProgress';
import { listPath } from '../utils/tabPaths';

const ROTATE_MS = 7000;

// The photo to show for a feature: the first of these places that has one,
// else any place of the kind that does.
const PREFERRED_PHOTOS = {
  mtb: ['Hampton Hills Mountain Bike Trailhead', 'East Rim Trailhead'],
  happening: ['Brandywine Falls', 'Ledges Overlook', 'Everett Covered Bridge']
};

const MAX_PHOTOS = 6;

// Photos to try for a feature, best first: a place can be flagged as having a
// photo the image server no longer holds, so the banner moves on to the next.
function photosOf(pois, preferred) {
  const withPhoto = pois.filter(poi => poi.has_primary_image);
  const named = preferred.map(name => withPhoto.find(poi => poi.name === name)).filter(Boolean);
  return [...new Set([...named, ...withPhoto])]
    .slice(0, MAX_PHOTOS)
    .map(poi => `/api/pois/${poi.id}/thumbnail?size=medium&v=${poi.updated_at || ''}`);
}

/**
 * The features the banner advertises, in order (spec 050).
 *
 * @param {object} state
 * @param {object|null} state.list The featured curated list in season, if any
 * @param {object[]} state.listCheckins The person's check-ins
 * @param {object[]} state.destinations Every point POI, for the photos
 * @param {{open: number, total: number}|null} state.mtb How many MTB trails are open, once known
 * @returns {{id: string, title: string, text: string, cta: string, to: string, images: string[], imageHasTitle?: boolean}[]}
 *   `cta` names where a tap goes; `images` are photos to try in order; `imageHasTitle` says the photo already carries the feature's name
 */
export function featureSlides({ list, listCheckins, destinations, mtb }) {
  const slides = [];
  if (list) {
    const progress = listProgress(list, listCheckins);
    const tally = progress.earned
      ? 'Badge earned'
      : progress.done > 0 ? `${progress.done} of ${progress.goal} hiked` : `Through ${formatListDay(list.ends_on)}`;
    slides.push({
      id: `list-${list.slug}`,
      title: list.name,
      text: `${tally} · ${list.items.length} trails`,
      cta: `Open ${list.name}`,
      to: listPath(list.slug),
      images: list.hero_image ? [list.hero_image] : [],
      imageHasTitle: Boolean(list.hero_image)
    });
  }

  const mtbTrailheads = destinations.filter(poi => poi.status_url && poi.status_url.trim() !== '');
  if (mtbTrailheads.length > 0) {
    slides.push({
      id: 'mtb',
      title: 'MTB Trail Status',
      text: mtb && mtb.total > 0
        ? `${mtb.open} of ${mtb.total} trails open right now`
        : 'Open or closed? Know before you load the bike.',
      cta: 'Check trail status',
      to: '/mtb-trail-status',
      images: photosOf(mtbTrailheads, PREFERRED_PHOTOS.mtb)
    });
  }

  slides.push({
    id: 'happening',
    title: 'Happening in the valley',
    text: 'News and events from every park, in one place.',
    cta: 'See what\'s on',
    to: '/happening',
    images: photosOf(destinations, PREFERRED_PHOTOS.happening)
  });
  return slides;
}

/**
 * The rotating banner in Find's header: one other part of the site at a time,
 * each a way in. It is dark, photographic and labelled with where a tap goes,
 * so it reads as a door to somewhere else rather than as part of the list. It rotates on its own unless the person has asked for less
 * motion, is pointing at it, or has picked a slide themselves.
 *
 * @param {object} props
 * @param {object[]} props.destinations Every point POI
 */
export default function FeatureBanner({ destinations }) {
  const navigate = useNavigate();
  const { listCheckins } = useAuth();
  const lists = useActiveLists();
  const [mtb, setMtb] = useState(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failedImages, setFailedImages] = useState(() => new Set());

  useEffect(() => {
    let current = true;
    fetch('/api/trail-status/mtb-trails')
      .then(res => (res.ok ? res.json() : []))
      .then(trails => {
        if (current) setMtb({ open: trails.filter(trail => trail.status === 'open').length, total: trails.length });
      })
      .catch(err => console.warn('Could not load MTB trail status for the banner:', err));
    return () => { current = false; };
  }, []);

  const slides = useMemo(
    () => featureSlides({ list: lists.find(l => l.featured) || null, listCheckins, destinations: destinations || [], mtb }),
    [lists, listCheckins, destinations, mtb]
  );
  const shown = index % slides.length;
  const slide = slides[shown];

  useEffect(() => {
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (paused || calm || slides.length < 2) return undefined;
    const timer = setInterval(() => setIndex(current => current + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, slides.length]);

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
    >
      <button
        type="button"
        key={slide.id}
        className={`feature-banner-slide ${hasImage ? '' : 'plain'} ${titled ? 'titled' : ''}`}
        onClick={() => navigate(slide.to)}
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
