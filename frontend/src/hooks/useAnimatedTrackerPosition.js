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

export default function useAnimatedTrackerPosition(rawPosition, lineCoords, zoom, { pollIntervalMs = 5000, iconHalfPx = 32, snapPosition = true } = {}) {
  const [animated, setAnimated] = useState(null);
  const prevSnapRef = useRef(null);
  const prevRawRef = useRef(null);
  const targetRawRef = useRef(null);
  const pathRef = useRef(null);
  const distsRef = useRef(null);
  const startTimeRef = useRef(0);
  const directionRef = useRef(1);
  const rafRef = useRef(null);
  const latestSnapRef = useRef(null);
  const zoomRef = useRef(zoom || 13);
  const intervalRef = useRef(pollIntervalMs);
  const halfPxRef = useRef(iconHalfPx);
  const prevBearingRef = useRef(0);

  useEffect(() => { zoomRef.current = zoom || 13; }, [zoom]);

  useEffect(() => {
    if (!rawPosition || !lineCoords || lineCoords.length < 2) {
      setAnimated(null);
      return;
    }

    const newSnap = snapToLine(
      [rawPosition.latitude, rawPosition.longitude],
      lineCoords
    );
    latestSnapRef.current = newSnap;

    if (!prevSnapRef.current) {
      prevSnapRef.current = newSnap;
      prevRawRef.current = rawPosition;
      targetRawRef.current = rawPosition;
      pathRef.current = [newSnap.position, newSnap.position];
      distsRef.current = [0, 0];
      startTimeRef.current = performance.now();
      let bearing;
      if (snapPosition) {
        const halfDist = pixelsToMeters(halfPxRef.current, zoomRef.current);
        bearing = dualSnapBearing(lineCoords, newSnap, halfDist);
        if (rawPosition.heading != null) {
          const diff = Math.abs(((bearing - rawPosition.heading + 540) % 360) - 180);
          if (diff > 90) {
            bearing = (bearing + 180) % 360;
            directionRef.current = -1;
          }
        }
      } else {
        bearing = rawPosition.heading || 0;
      }
      const pos = snapPosition ? newSnap.position : [rawPosition.latitude, rawPosition.longitude];
      setAnimated({ position: pos, bearing });
      return;
    }

    const prev = prevSnapRef.current;
    const dLat = rawPosition.latitude - (prev.position[0] || 0);
    const dLng = rawPosition.longitude - (prev.position[1] || 0);
    if (Math.abs(dLat) > 1e-6 || Math.abs(dLng) > 1e-6) {
      const heading = ((Math.atan2(dLng, dLat) * 180 / Math.PI) + 360) % 360;
      const diff = Math.abs(((newSnap.bearing - heading + 540) % 360) - 180);
      directionRef.current = diff > 90 ? -1 : 1;
    }

    prevRawRef.current = targetRawRef.current || rawPosition;
    targetRawRef.current = rawPosition;

    const subPath = extractSubPath(lineCoords, prev, newSnap);
    pathRef.current = subPath;
    distsRef.current = cumulativeDistances(subPath);
    startTimeRef.current = performance.now();
    prevSnapRef.current = newSnap;
  }, [rawPosition, lineCoords, snapPosition]);

  const tick = useCallback(() => {
    const t = Math.min(1, (performance.now() - startTimeRef.current) / intervalRef.current);

    let position, bearing;

    if (snapPosition) {
      const path = pathRef.current;
      const dists = distsRef.current;
      if (!path || !dists || path.length < 2 || !lineCoords) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      position = interpolateAlongPath(path, dists, t).position;
      const reSnap = snapToLine(position, lineCoords);
      const halfDist = pixelsToMeters(halfPxRef.current, zoomRef.current);
      bearing = dualSnapBearing(lineCoords, reSnap, halfDist);
      if (directionRef.current === -1) {
        bearing = (bearing + 180) % 360;
      }
    } else {
      const prev = prevRawRef.current;
      const target = targetRawRef.current;
      if (!prev || !target) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      position = [
        prev.latitude + t * (target.latitude - prev.latitude),
        prev.longitude + t * (target.longitude - prev.longitude),
      ];
      bearing = lerpAngle(prev.heading || 0, target.heading || 0, t);
    }

    setAnimated({ position, bearing });
    rafRef.current = requestAnimationFrame(tick);
  }, [lineCoords, snapPosition]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  return animated;
}
