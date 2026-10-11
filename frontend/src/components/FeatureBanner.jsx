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
 * @returns {{id: string, title: string, text: string, to: string, images: string[], imageHasTitle?: boolean}[]}
 *   `images` are photos to try in order; `imageHasTitle` says the photo already carries the feature's name
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
      to: '/mtb-trail-status',
      images: photosOf(mtbTrailheads, PREFERRED_PHOTOS.mtb)
    });
  }

  slides.push({
    id: 'happening',
    title: 'Happening in the valley',
    text: 'News and events from every park, in one place.',
    to: '/happening',
    images: photosOf(destinations, PREFERRED_PHOTOS.happening)
  });
  return slides;
}

/**
 * The rotating banner at the top of Find: one feature of the site at a time,
 * each a way in. It rotates on its own unless the person has asked for less
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

  return (
    <section
      className="feature-banner"
      aria-roledescription="carousel"
      aria-label="Features"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button type="button" key={slide.id} className="feature-banner-slide" onClick={() => navigate(slide.to)}>
        <span className={`feature-banner-picture ${hasImage ? '' : 'plain'}`}>
          {hasImage && (
            <img
              src={image}
              alt=""
              onError={() => setFailedImages(failed => new Set(failed).add(image))}
            />
          )}
          {!(hasImage && slide.imageHasTitle) && <span className="feature-banner-title">{slide.title}</span>}
        </span>
        <span className="feature-banner-row">
          <span className="feature-banner-text">
            <strong>{slide.title}</strong>
            <span>{slide.text}</span>
          </span>
          <span className="feature-banner-go" aria-hidden="true">›</span>
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
