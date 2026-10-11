import React, { useState } from 'react';
import { useFeatureSlides, storedIds } from '../../hooks/useFeatureSlides';

const KEY_DISMISSED = 'rotv-feature-dismissed';

/**
 * The feature spotlight on the map (spec 050): a pill naming one other part of
 * the site, with a few words of what is there now, that opens it. It always
 * shows a feature the person has not opened yet while one is left, so opening
 * one brings up the next. Closing it hides every feature known today; a new
 * one, such as next season's list, brings the pill back.
 *
 * @param {object} props
 * @param {object[]} props.destinations Every point POI
 * @param {object[]} props.routes Every river, railroad and water taxi
 * @returns {JSX.Element|null}
 */
export default function SeasonalFeature({ destinations, routes }) {
  const { slides, open } = useFeatureSlides(destinations, routes);
  const [dismissed, setDismissed] = useState(() => storedIds(KEY_DISMISSED));

  const feature = slides.find(slide => !dismissed.includes(slide.id));
  if (!feature) return null;

  const dismiss = () => {
    const next = [...new Set([...dismissed, ...slides.map(slide => slide.id)])];
    setDismissed(next);
    try {
      localStorage.setItem(KEY_DISMISSED, JSON.stringify(next));
    } catch {
      return;
    }
  };

  return (
    <div className="seasonal-feature-pill">
      <button type="button" className="seasonal-feature-open" onClick={() => open(feature)}>
        <span aria-hidden="true">{feature.icon}</span> {feature.title} <span className="seasonal-feature-tally">· {feature.short}</span>
      </button>
      <button type="button" className="seasonal-feature-dismiss" onClick={dismiss} aria-label="Hide feature suggestions">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.410 10.59 12 5 17.590 6.41 19 12 13.410 17.590 19 19 17.590 13.410 12z" />
        </svg>
      </button>
    </div>
  );
}
