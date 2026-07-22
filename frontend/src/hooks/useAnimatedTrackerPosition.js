import { useState, useEffect, useRef, useCallback } from 'react';
import { snapToLine } from '../utils/snapToLine';
import {
  dualSnapBearing, lineCumulativeDistances, arcDistanceAt, snapAtArc, haversineDist,
  bearingHalfSpan,
} from '../utils/trackInterpolation';

// The GPS device reports on its own cadence (measured ~10-20s for the CVSR
// unit), while the frontend polls every few seconds and re-delivers the same
// fix. Raw coordinates sit meters off the track geometry, so any comparison
// against a SNAPPED point reads as phantom movement on every poll — the old
// 1e-6° (11cm) gate fired constantly and re-derived travel direction from the
// perpendicular raw-vs-snap offset, a coin flip that made the icon face
// backwards at random. Gate on raw-to-raw displacement at GPS-noise scale
// instead, and only re-decide direction after real along-track travel.
const MIN_MOVE_M = 3;
const MIN_DIRECTION_M = 5;

// Tween duration adapts to the measured gap between accepted fixes — a fixed
// duration shorter than the device cadence sprints then freezes ("moves for a
// while, then stops"). Clamped so a data outage neither snaps (min) nor
// crawls across the map for minutes (max); beyond TELEPORT_M jump instead of
// animating through a long outage.
const MIN_TWEEN_MS = 4000;
const MAX_TWEEN_MS = 30000;
const TELEPORT_M = 1000;

/**
 * Timestamp of a GPS fix in epoch ms. Prefers the device's own fix time —
 * arrival times carry 0-10s of poll-phase jitter from the two unsynchronized
 * 5s polls (device→backend→frontend).
 * @param {{updatedAt?: string}} rawPosition tracker API position
 * @returns {number} epoch ms (falls back to now when updatedAt is absent)
 */
function fixEpochMs(rawPosition) {
  const parsed = Date.parse(rawPosition.updatedAt || '');
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Animate a polled GPS tracker position for a map marker.
 *
 * Track-following mode (snapPosition=true) snaps fixes to the line geometry
 * and tweens the ARC DISTANCE between them, so each frame is an O(log n)
 * table lookup rather than a re-snap against the full geometry. It keeps
 * { position, snap, direction } in state and derives the icon bearing DURING
 * RENDER from the current zoom: the bearing depends on zoom (front/back snap
 * points span the icon's ground footprint), and computing it in an effect
 * chain paints a frame or more behind the camera — the marker visibly pivots
 * after a zoom settles (#554). Raw mode (snapPosition=false) lerps positions
 * and headings directly (water taxi).
 *
 * @param {{latitude: number, longitude: number, heading?: number, updatedAt?: string}|null} rawPosition
 *   latest polled fix (re-delivered unchanged between device reports)
 * @param {Array<[number, number]>|null} lineCoords route geometry, GeoJSON [lng, lat]
 * @param {number} zoom current map zoom (bearing footprint scaling)
 * @param {{pollIntervalMs?: number, iconHalfPx?: number, snapPosition?: boolean}} [opts]
 * @returns {{position: [number, number], bearing: number, arc?: number, direction?: number}|null}
 *   null until the first fix lands. In track-following mode the result also
 *   carries `arc` (meters along the line) and `direction` (+1/-1 travel
 *   direction), which let a caller place further markers at fixed offsets on
 *   the same track — see buildConsist() (#533). Raw mode omits both.
 */
export default function useAnimatedTrackerPosition(rawPosition, lineCoords, zoom, { pollIntervalMs = 5000, iconHalfPx = 32, snapPosition = true } = {}) {
  const [animated, setAnimated] = useState(null);
  const lastRawRef = useRef(null);
  const lastFixMsRef = useRef(0);
  const prevArcRef = useRef(0);
  const lineDistsRef = useRef({ coords: null, dists: null });
  const displayedRef = useRef(null);
  const tweenStartRef = useRef(null);
  const tweenStartArcRef = useRef(0);
  const tweenTargetArcRef = useRef(0);
  const startTimeRef = useRef(0);
  const durationRef = useRef(pollIntervalMs);
  const directionRef = useRef(1);
  const movingRef = useRef(false);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!rawPosition || !lineCoords || lineCoords.length < 2) {
      setAnimated(null);
      lastRawRef.current = null;
      movingRef.current = false;
      return;
    }

    if (lineDistsRef.current.coords !== lineCoords) {
      lineDistsRef.current = { coords: lineCoords, dists: lineCumulativeDistances(lineCoords) };
    }
    const lineDists = lineDistsRef.current.dists;

    const newSnap = snapToLine(
      [rawPosition.latitude, rawPosition.longitude],
      lineCoords
    );
    const newArc = arcDistanceAt(lineDists, newSnap);

    if (!lastRawRef.current) {
      lastRawRef.current = rawPosition;
      lastFixMsRef.current = fixEpochMs(rawPosition);
      prevArcRef.current = newArc;
      movingRef.current = false;
      // Until movement disambiguates travel direction, trust the upstream
      // GPS heading to decide which way the icon faces along the track.
      if (rawPosition.heading != null) {
        const diff = Math.abs(((newSnap.bearing - rawPosition.heading + 540) % 360) - 180);
        directionRef.current = diff > 90 ? -1 : 1;
      }
      const initial = snapPosition
        ? { position: newSnap.position, snap: newSnap, direction: directionRef.current }
        : { position: [rawPosition.latitude, rawPosition.longitude], heading: rawPosition.heading || 0 };
      displayedRef.current = initial;
      setAnimated(initial);
      return;
    }

    const prevRaw = lastRawRef.current;
    const movedM = haversineDist(
      prevRaw.latitude, prevRaw.longitude,
      rawPosition.latitude, rawPosition.longitude
    );

    // Same fix re-delivered by the poll, or sub-noise jitter: hold. An
    // in-flight tween keeps its runway; direction is NOT re-derived (#554
    // follow-up — jitter-derived direction is what flipped the icon).
    if (movedM < MIN_MOVE_M) return;

    const arcDelta = newArc - prevArcRef.current;
    if (Math.abs(arcDelta) >= MIN_DIRECTION_M) {
      directionRef.current = arcDelta > 0 ? 1 : -1;
    }

    const fixMs = fixEpochMs(rawPosition);
    durationRef.current = Math.min(MAX_TWEEN_MS, Math.max(MIN_TWEEN_MS, fixMs - lastFixMsRef.current));
    lastFixMsRef.current = fixMs;
    lastRawRef.current = rawPosition;
    prevArcRef.current = newArc;

    const displayed = displayedRef.current;

    if (snapPosition) {
      if (Math.abs(arcDelta) > TELEPORT_M) {
        movingRef.current = false;
        const jumped = { position: newSnap.position, snap: newSnap, direction: directionRef.current };
        displayedRef.current = jumped;
        setAnimated(jumped);
        return;
      }
      // Tween from where the marker IS, not from the previous fix's target —
      // a fix landing mid-tween otherwise restarts with a visible jump. The
      // displayed snap came from snapAtArc/snapToLine, so its arc is exact.
      tweenStartArcRef.current = displayed?.snap
        ? arcDistanceAt(lineDists, displayed.snap)
        : newArc;
      tweenTargetArcRef.current = newArc;
    } else {
      // Raw-lerp mode tweens from where the marker currently IS (same
      // mid-tween restart rule as the track path above).
      tweenStartRef.current = displayed;
    }

    startTimeRef.current = performance.now();
    movingRef.current = true;
  }, [rawPosition, lineCoords, snapPosition]);

  const tick = useCallback(() => {
    if (!movingRef.current) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    const t = Math.min(1, (performance.now() - startTimeRef.current) / durationRef.current);

    if (snapPosition) {
      const lineDists = lineDistsRef.current.dists;
      if (!lineCoords || !lineDists) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const arc = tweenStartArcRef.current + t * (tweenTargetArcRef.current - tweenStartArcRef.current);
      const snap = snapAtArc(lineCoords, lineDists, arc);
      const frame = { position: snap.position, snap, direction: directionRef.current };
      displayedRef.current = frame;
      setAnimated(frame);
    } else {
      const prev = tweenStartRef.current;
      const target = lastRawRef.current;
      if (!prev || !target) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Shortest-arc heading interpolation (never swings the long way round)
      const headingDiff = (((target.heading || 0) - (prev.heading || 0) + 540) % 360) - 180;
      const frame = {
        position: [
          prev.position[0] + t * (target.latitude - prev.position[0]),
          prev.position[1] + t * (target.longitude - prev.position[1]),
        ],
        heading: (((prev.heading || 0) + headingDiff * t) + 360) % 360,
      };
      displayedRef.current = frame;
      setAnimated(frame);
    }

    // Tween complete: stop emitting frames until the next accepted fix.
    if (t >= 1) movingRef.current = false;

    rafRef.current = requestAnimationFrame(tick);
  }, [lineCoords, snapPosition]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  if (!animated) return null;
  if (!snapPosition) return { position: animated.position, bearing: animated.heading };

  const halfDist = bearingHalfSpan(zoom, iconHalfPx);
  let bearing = dualSnapBearing(lineCoords, animated.snap, halfDist);
  if (animated.direction === -1) bearing = (bearing + 180) % 360;

  // arc + direction let a caller place additional markers at fixed offsets
  // along the same track — the train consist trailing the lead engine (#533).
  const lineDists = lineDistsRef.current.dists;
  return {
    position: animated.position,
    bearing,
    arc: lineDists ? arcDistanceAt(lineDists, animated.snap) : 0,
    direction: animated.direction,
  };
}
