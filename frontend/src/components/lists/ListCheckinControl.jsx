import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { checkinDateBounds, formatListDay } from '../../utils/listProgress';

const CHECK = 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
const CIRCLE = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z';

/**
 * Check one hike off a curated list (spec 050). One tap logs it for today and
 * shows the date beside the button, where it can be set to any day the list's
 * rules allow. Tapping the checked button takes the hike back.
 *
 * @param {object} props
 * @param {object} props.list The list, from /api/lists
 * @param {object|null} [props.item=null] The list item; null is the list's free choice
 * @param {number|null} [props.choicePoiId=null] For the free choice: the trail chosen
 * @param {string} [props.className='poi-action'] Class for the button
 */
export default function ListCheckinControl({ list, item = null, choicePoiId = null, className = 'poi-action' }) {
  const { listCheckins, saveListCheckin, removeListCheckin } = useAuth();
  const [problem, setProblem] = useState(null);

  const itemId = item ? item.id : null;
  const checkin = listCheckins.find(c => c.list_id === list.id && (c.item_id ?? null) === itemId);
  const bounds = checkinDateBounds(list);
  const poiId = item ? item.poi_id : (choicePoiId ?? checkin?.poi_id ?? null);
  const hikeName = item ? item.label : list.choice_label;

  const save = async (doneOn) => {
    setProblem(await saveListCheckin(list.id, itemId, poiId, doneOn));
  };

  const stop = (e) => e.stopPropagation();

  if (!bounds) {
    return (
      <span className="list-checkin-closed">Opens {formatListDay(list.starts_on)}</span>
    );
  }

  return (
    <div className="list-checkin" onClick={stop} onKeyDown={stop}>
      <div className="list-checkin-row">
        {checkin ? (
          <button
            type="button"
            className={`${className} list-checkin-btn done`}
            aria-pressed="true"
            onClick={() => { setProblem(null); removeListCheckin(list.id, itemId); }}
            title="Tap to un-mark this hike"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={CHECK} /></svg>
            Hiked
          </button>
        ) : (
          <button
            type="button"
            className={`${className} list-checkin-btn`}
            aria-pressed="false"
            disabled={!poiId}
            onClick={() => save(bounds.max)}
            title="Log this hike"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d={CIRCLE} /></svg>
            Mark hiked
          </button>
        )}
        {checkin && (
          <label className="list-checkin-date">
            <span>on</span>
            <input
              type="date"
              aria-label={`Date you hiked ${hikeName}`}
              value={checkin.done_on}
              min={bounds.min}
              max={bounds.max}
              onChange={(e) => {
                const picked = e.target.value;
                if (picked && picked >= bounds.min && picked <= bounds.max) save(picked);
              }}
            />
          </label>
        )}
      </div>
      {problem && <div className="list-checkin-problem" role="alert">{problem}</div>}
    </div>
  );
}
