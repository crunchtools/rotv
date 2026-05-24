import { useState, useEffect, useCallback, useRef } from 'react';
import LevelChart from '../LevelChart';

/**
 * "River Levels" sidebar tab (#92).
 * A carousel of the USGS gauges along a river — one gauge at a time, navigable by the
 * left/right arrow keys, swiping, the prev/next arrows, or the dots. The gauge in view is
 * published via onActiveGaugeChange so the map can highlight it and zoom to it. Discharge
 * (cfs) is the default series; gauges with no discharge (e.g. lake-influenced sites) fall
 * back to gage height.
 */

function relativeTime(iso) {
  if (!iso) return 'no data';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function fmt(value, unit) {
  if (value == null) return '—';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
}

function GaugeCard({ gauge, cachedReadings }) {
  const [readings, setReadings] = useState(cachedReadings ?? null);
  const [error, setError] = useState(false);
  const [metric, setMetric] = useState(
    gauge.latest?.discharge_cfs != null ? 'discharge_cfs' : 'gage_height_ft'
  );

  useEffect(() => {
    if (cachedReadings) { setReadings(cachedReadings); return; }
    setReadings(null);
    setError(false);
  }, [gauge.id, cachedReadings]);

  const dischargeAvailable = readings
    ? readings.some(r => r.discharge_cfs != null)
    : gauge.latest?.discharge_cfs != null;
  const heightAvailable = readings
    ? readings.some(r => r.gage_height_ft != null)
    : gauge.latest?.gage_height_ft != null;

  useEffect(() => {
    if (readings === null) return;
    if (metric === 'discharge_cfs' && !dischargeAvailable && heightAvailable) setMetric('gage_height_ft');
    else if (metric === 'gage_height_ft' && !heightAvailable && dischargeAvailable) setMetric('discharge_cfs');
  }, [readings, metric, dischargeAvailable, heightAvailable]);

  const latest = gauge.latest;

  return (
    <div className="river-gauge-card">
      <h3 className="river-gauge-name">{gauge.name || gauge.usgs_site_id}</h3>
      <div className="river-gauge-current">
        <span className="river-gauge-value">{fmt(latest?.discharge_cfs, 'cfs')}</span>
        <span className="river-gauge-sep">•</span>
        <span className="river-gauge-value">{fmt(latest?.gage_height_ft, 'ft')}</span>
        <span className="river-gauge-sep">•</span>
        <span className="river-gauge-time">{relativeTime(latest?.reading_time)}</span>
      </div>

      <div className="river-gauge-metric-toggle" role="group" aria-label="Chart metric">
        <button
          className={metric === 'discharge_cfs' ? 'active' : ''}
          disabled={!dischargeAvailable}
          onClick={() => setMetric('discharge_cfs')}
        >Discharge</button>
        <button
          className={metric === 'gage_height_ft' ? 'active' : ''}
          disabled={!heightAvailable}
          onClick={() => setMetric('gage_height_ft')}
        >Gage height</button>
      </div>

      {error ? (
        <p className="river-levels-empty">Couldn't load readings.</p>
      ) : readings === null ? (
        <p className="river-levels-empty">Loading…</p>
      ) : (
        <LevelChart readings={readings} metric={metric} />
      )}

      <a className="river-gauge-link" href={gauge.usgs_url} target="_blank" rel="noopener noreferrer">
        View on USGS ↗
      </a>
    </div>
  );
}

function RiverLevels({ poiId, onActiveGaugeChange }) {
  const [gauges, setGauges] = useState(null);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(null);
  const readingsCache = useRef(new globalThis.Map());
  const [cacheVersion, setCacheVersion] = useState(0);

  useEffect(() => {
    if (!poiId) return undefined;
    let cancelled = false;
    readingsCache.current.clear();
    setCacheVersion(0);
    fetch(`/api/pois/${poiId}/river-gauges`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => {
        if (cancelled) return;
        setGauges(data);
        const focusId = new URLSearchParams(window.location.search).get('gauge');
        if (focusId) {
          const i = data.findIndex(g => String(g.id) === String(focusId));
          if (i >= 0) setIndex(i);
        }
        Promise.all(data.map(g =>
          fetch(`/api/river-gauges/${g.id}/readings?days=7`)
            .then(res => (res.ok ? res.json() : { readings: [] }))
            .then(d => ({ id: g.id, readings: d.readings || [] }))
            .catch(() => ({ id: g.id, readings: [] }))
        )).then(results => {
          if (cancelled) return;
          results.forEach(r => readingsCache.current.set(r.id, r.readings));
          setCacheVersion(v => v + 1);
        });
      })
      .catch(() => { if (!cancelled) setGauges([]); });
    return () => { cancelled = true; };
  }, [poiId]);

  const count = gauges?.length || 0;
  const go = useCallback((delta) => {
    setIndex(prev => (count ? (prev + delta + count) % count : 0));
  }, [count]);

  // Left/right arrow keys move between gauges (ignored while typing in a field)
  useEffect(() => {
    if (count <= 1) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, go]);

  const safeIndex = gauges ? Math.min(index, Math.max(count - 1, 0)) : 0;
  const current = gauges && count > 0 ? gauges[safeIndex] : null;

  // Publish the gauge in view so the map can highlight it and fly to it.
  useEffect(() => {
    if (onActiveGaugeChange && current) onActiveGaugeChange(current);
  }, [current?.id, onActiveGaugeChange, current]);

  // Clear the map highlight when the tab closes.
  useEffect(() => () => { if (onActiveGaugeChange) onActiveGaugeChange(null); }, [onActiveGaugeChange]);

  if (gauges === null) {
    return <div className="river-levels-tab"><p className="river-levels-empty">Loading…</p></div>;
  }
  if (count === 0) {
    return <div className="river-levels-tab"><p className="river-levels-empty">No gauge data yet for this river.</p></div>;
  }

  const onTouchStart = (e) => {
    e.stopPropagation();
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchMove = (e) => { e.stopPropagation(); };
  const onTouchEnd = (e) => {
    e.stopPropagation();
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  };

  return (
    <div className="river-levels-tab" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="river-gauge-carousel-wrapper">
        {count > 1 && (
          <button
            className="river-gauge-nav-arrow river-gauge-nav-prev"
            onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); go(-1); }}
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Previous gauge"
          >‹</button>
        )}

        <GaugeCard gauge={current} cachedReadings={readingsCache.current.get(current.id) ?? null} />

        {count > 1 && (
          <button
            className="river-gauge-nav-arrow river-gauge-nav-next"
            onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); go(1); }}
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Next gauge"
          >›</button>
        )}
      </div>

      <p className="river-gauge-subtitle">Official USGS gauge readings for kayakers</p>

      {count > 1 && (
        <div className="river-gauge-footer">
          <span className="river-gauge-pager">{safeIndex + 1} of {count} gauges</span>
          <div className="river-gauge-dots" role="tablist" aria-label="Select gauge">
            {gauges.map((g, i) => (
              <button
                key={g.id}
                className={`river-gauge-dot-btn ${i === safeIndex ? 'active' : ''}`}
                onClick={() => setIndex(i)}
                aria-label={g.name || g.usgs_site_id}
                aria-selected={i === safeIndex}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default RiverLevels;
