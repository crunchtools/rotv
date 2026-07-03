import { useState, useEffect, useRef, useCallback } from 'react';
import { snapToLine } from '../utils/snapToLine';
import { extractSubPath, cumulativeDistances, interpolateAlongPath, dualSnapBearing } from '../utils/trackInterpolation';

function pixelsToMeters(halfPx, zoom) {
  return halfPx * 156543.03 * Math.cos(41.26 * Math.PI / 180) / (2 ** zoom);
}

function lerpAngle(a, b, t) {
  let diff = ((b - a + 540) % 360) - 180;
  return ((a + diff * t) + 360) % 360;
}

// Track-following mode keeps { position, snap, direction } in state and derives
// the bearing DURING RENDER from the current zoom. The bearing depends on zoom
// (front/back snap points span the icon's ground footprint), and computing it in
// an effect chain paints a frame or more behind the camera — the train visibly
// pivots after a zoom settles (#554). Render-time derivation means every painted
// frame carries the bearing that matches that frame's zoom.
export default function useAnimatedTrackerPosition(rawPosition, lineCoords, zoom, { pollIntervalMs = 5000, iconHalfPx = 32, snapPosition = true } = {}) {
  const [animated, setAnimated] = useState(null);
  const prevSnapRef = useRef(null);
  const prevRawRef = useRef(null);
  const targetRawRef = useRef(null);
  const pathRef = useRef(null);
  const distsRef = useRef(null);
  const startTimeRef = useRef(0);
  const directionRef = useRef(1);
  const movingRef = useRef(false);
  const rafRef = useRef(null);
  const intervalRef = useRef(pollIntervalMs);

  useEffect(() => {
    if (!rawPosition || !lineCoords || lineCoords.length < 2) {
      setAnimated(null);
      return;
    }

    const newSnap = snapToLine(
      [rawPosition.latitude, rawPosition.longitude],
      lineCoords
    );

    if (!prevSnapRef.current) {
      prevSnapRef.current = newSnap;
      prevRawRef.current = rawPosition;
      targetRawRef.current = rawPosition;
      movingRef.current = false;
      // Until movement disambiguates travel direction, trust the upstream
      // GPS heading to decide which way the icon faces along the track.
      if (rawPosition.heading != null) {
        const diff = Math.abs(((newSnap.bearing - rawPosition.heading + 540) % 360) - 180);
        directionRef.current = diff > 90 ? -1 : 1;
      }
      setAnimated(snapPosition
        ? { position: newSnap.position, snap: newSnap, direction: directionRef.current }
        : { position: [rawPosition.latitude, rawPosition.longitude], heading: rawPosition.heading || 0 });
      return;
    }

    const prev = prevSnapRef.current;
    const dLat = rawPosition.latitude - (prev.position[0] || 0);
    const dLng = rawPosition.longitude - (prev.position[1] || 0);
    const hasMoved = Math.abs(dLat) > 1e-6 || Math.abs(dLng) > 1e-6;

    if (hasMoved) {
      const heading = ((Math.atan2(dLng, dLat) * 180 / Math.PI) + 360) % 360;
      const diff = Math.abs(((newSnap.bearing - heading + 540) % 360) - 180);
      directionRef.current = diff > 90 ? -1 : 1;
    }

    prevRawRef.current = targetRawRef.current || rawPosition;
    targetRawRef.current = rawPosition;

    if (hasMoved) {
      pathRef.current = extractSubPath(lineCoords, prev, newSnap);
      distsRef.current = cumulativeDistances(pathRef.current);
      movingRef.current = true;
    } else {
      // Stationary: hold the last committed position — no path, no tick work,
      // nothing to drift (#554)
      pathRef.current = null;
      distsRef.current = null;
      movingRef.current = false;
    }

    startTimeRef.current = performance.now();
    prevSnapRef.current = newSnap;
  }, [rawPosition, lineCoords, snapPosition]);

  const tick = useCallback(() => {
    if (!movingRef.current) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const t = Math.min(1, (performance.now() - startTimeRef.current) / intervalRef.current);

    if (snapPosition) {
      const path = pathRef.current;
      const dists = distsRef.current;
      if (!path || !dists || path.length < 2 || !lineCoords) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const position = interpolateAlongPath(path, dists, t).position;
      const reSnap = snapToLine(position, lineCoords);
      setAnimated({ position, snap: reSnap, direction: directionRef.current });
    } else {
      const prev = prevRawRef.current;
      const target = targetRawRef.current;
      if (!prev || !target) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      setAnimated({
        position: [
          prev.latitude + t * (target.latitude - prev.latitude),
          prev.longitude + t * (target.longitude - prev.longitude),
        ],
        heading: lerpAngle(prev.heading || 0, target.heading || 0, t),
      });
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [lineCoords, snapPosition]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  if (!animated) return null;
  if (!snapPosition) return { position: animated.position, bearing: animated.heading };

  const halfDist = pixelsToMeters(iconHalfPx, zoom || 13);
  let bearing = dualSnapBearing(lineCoords, animated.snap, halfDist);
  if (animated.direction === -1) bearing = (bearing + 180) % 360;
  return { position: animated.position, bearing };
}
