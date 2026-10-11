import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useActiveLists } from './useActiveLists';
import { listProgress, formatListDay } from '../utils/listProgress';
import { listPath } from '../utils/tabPaths';
import { generateSlug } from '../components/sidebar/helpers';

// The photo to show for a feature: the first of these places that has one,
// else any place of the kind that does.
const PREFERRED_PHOTOS = {
  mtb: ['Hampton Hills Mountain Bike Trailhead', 'East Rim Trailhead'],
  happening: ['Brandywine Falls', 'Ledges Overlook', 'Everett Covered Bridge']
};

// The places whose live data a feature shows off.
const LIVE_PLACES = {
  river: 'Cuyahoga River',
  gauge: 'Jaite',
  train: 'Cuyahoga Valley Scenic Railroad',
  taxi: 'Harbor Hopper'
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
 * The features the site advertises, in order (spec 050).
 *
 * @param {object} state
 * @param {object|null} state.list The featured curated list in season, if any
 * @param {object[]} state.listCheckins The person's check-ins
 * @param {object[]} state.destinations Every point POI, for the photos
 * @param {object[]} [state.routes] Every river, railroad and water taxi, for the live features
 * @param {{open: number, total: number}|null} state.mtb How many MTB trails are open, once known
 * @param {object[]} [state.gauges] River gauges with their latest reading, once known
 * @returns {{id: string, icon: string, title: string, text: string, short: string, cta: string, to: string,
 *   images: string[], imageHasTitle?: boolean}[]}
 *   `cta` names where a tap goes; `short` is the few words that fit beside the title on the map;
 *   `images` are photos to try in order; `imageHasTitle` says the photo already carries the feature's name
 */
export function featureSlides({ list, listCheckins, destinations, routes = [], mtb, gauges = [] }) {
  const slides = [];
  if (list) {
    const progress = listProgress(list, listCheckins);
    const tally = progress.earned
      ? 'Badge earned'
      : progress.done > 0 ? `${progress.done} of ${progress.goal} hiked` : `Through ${formatListDay(list.ends_on)}`;
    slides.push({
      id: `list-${list.slug}-${list.edition}`,
      icon: '🍂',
      title: list.name,
      text: `${tally} · ${list.items.length} trails`,
      short: tally,
      cta: `Open ${list.name}`,
      to: listPath(list.slug),
      images: list.hero_image ? [list.hero_image] : [],
      imageHasTitle: Boolean(list.hero_image)
    });
  }

  const river = routes.find(poi => poi.name === LIVE_PLACES.river);
  if (river) {
    // The gauge inside the park when it is reporting, else any on the river that is.
    const reporting = gauges.filter(gauge => gauge.river_poi_id === river.id && gauge.latest?.discharge_cfs != null);
    const flowing = reporting.find(gauge => gauge.name === LIVE_PLACES.gauge) || reporting[0];
    const flow = flowing ? `${Math.round(flowing.latest.discharge_cfs).toLocaleString()} cfs at ${flowing.name}` : null;
    slides.push({
      id: 'river-levels',
      icon: '🌊',
      title: 'River Levels',
      text: flow ? `${flow} right now, with a 7-day chart` : 'Is the river runnable? Live flow and a 7-day chart.',
      short: flow || 'Live flow',
      cta: 'Check the river',
      to: `/${generateSlug(river.name)}/river_levels`,
      images: photosOf([river], [])
    });
  }

  const train = routes.find(poi => poi.name === LIVE_PLACES.train);
  if (train) {
    slides.push({
      id: 'train-tracker',
      icon: '🚂',
      title: 'Train Tracker',
      text: 'See where the Cuyahoga Valley Scenic Railroad is right now.',
      short: 'Live on the map',
      cta: 'Find the train',
      to: `/${generateSlug(train.name)}`,
      images: photosOf([train], [])
    });
  }

  const taxi = routes.find(poi => poi.name === LIVE_PLACES.taxi);
  if (taxi) {
    slides.push({
      id: 'water-taxi',
      icon: '⛴️',
      title: 'Water Taxi Tracker',
      text: `Watch the ${taxi.name} cross the Cuyahoga, live.`,
      short: 'Live on the map',
      cta: 'Find the water taxi',
      to: `/${generateSlug(taxi.name)}`,
      images: photosOf([taxi], [])
    });
  }

  const mtbTrailheads = destinations.filter(poi => poi.status_url && poi.status_url.trim() !== '');
  if (mtbTrailheads.length > 0) {
    const counted = mtb && mtb.total > 0;
    slides.push({
      id: 'mtb',
      icon: '🚵',
      title: 'MTB Trail Status',
      text: counted
        ? `${mtb.open} of ${mtb.total} trails open right now`
        : 'Open or closed? Know before you load the bike.',
      short: counted ? `${mtb.open} of ${mtb.total} open` : 'Open or closed?',
      cta: 'Check trail status',
      to: '/mtb-trail-status',
      images: photosOf(mtbTrailheads, PREFERRED_PHOTOS.mtb)
    });
  }

  slides.push({
    id: 'happening',
    icon: '📰',
    title: 'Happening in the valley',
    text: 'News and events from every park, in one place.',
    short: 'News and events',
    cta: 'See what\'s on',
    to: '/happening',
    images: photosOf(destinations, PREFERRED_PHOTOS.happening)
  });
  return slides;
}

/**
 * The features to advertise to this person, newest to them first: one they
 * have never opened leads, and the one opened longest ago follows the rest.
 * What they have opened is kept with their other preferences (AuthContext).
 *
 * @param {object[]} destinations Every point POI
 * @param {object[]} routes Every river, railroad and water taxi
 * @param {boolean} [reorderOnOpen=false] Put a feature behind the others the moment it is opened. The map's
 *   pill wants that; a banner would show a different slide for an instant before the page changed.
 * @returns {{slides: object[], open: (slide: object) => void}} `open` goes to a feature and remembers it was opened
 */
export function useFeatureSlides(destinations, routes, reorderOnOpen = false) {
  const navigate = useNavigate();
  const { listCheckins, featuresOpened = [], markFeatureOpened } = useAuth();
  const lists = useActiveLists();
  const [mtb, setMtb] = useState(null);
  const [gauges, setGauges] = useState([]);
  // A banner keeps the order it started with: see reorderOnOpen above.
  const [openedAtFirst] = useState(featuresOpened);
  const opened = reorderOnOpen ? featuresOpened : openedAtFirst;

  useEffect(() => {
    let current = true;
    fetch('/api/trail-status/mtb-trails')
      .then(res => (res.ok ? res.json() : []))
      .then(trails => {
        if (current) setMtb({ open: trails.filter(trail => trail.status === 'open').length, total: trails.length });
      })
      .catch(err => console.warn('Could not load MTB trail status for the feature banner:', err));
    fetch('/api/river-gauges')
      .then(res => (res.ok ? res.json() : []))
      .then(loaded => { if (current && Array.isArray(loaded)) setGauges(loaded); })
      .catch(err => console.warn('Could not load river levels for the feature banner:', err));
    return () => { current = false; };
  }, []);

  const slides = useMemo(() => {
    const all = featureSlides({
      list: lists.find(l => l.featured) || null, listCheckins, destinations: destinations || [], routes: routes || [], mtb, gauges
    });
    // Array.sort is stable, so features never opened keep the order above.
    return all.sort((a, b) => opened.indexOf(a.id) - opened.indexOf(b.id));
  }, [lists, listCheckins, destinations, routes, mtb, gauges, opened]);

  const open = useCallback((slide) => {
    if (markFeatureOpened) markFeatureOpened(slide.id);
    navigate(slide.to);
  }, [navigate, markFeatureOpened]);

  return { slides, open };
}
