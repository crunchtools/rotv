function haversineDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function extractSubPath(lineCoords, prevSnap, newSnap) {
  const si = prevSnap.segmentIndex;
  const ei = newSnap.segmentIndex;

  const startPt = prevSnap.position;
  const endPt = newSnap.position;

  if (si === ei) {
    return [startPt, endPt];
  }

  const forward = si < ei ||
    (si === ei && prevSnap.segmentT < newSnap.segmentT);

  const path = [startPt];
  if (forward) {
    for (let i = si + 1; i <= ei; i++) {
      path.push([lineCoords[i][1], lineCoords[i][0]]);
    }
  } else {
    for (let i = si; i >= ei + 1; i--) {
      path.push([lineCoords[i][1], lineCoords[i][0]]);
    }
  }
  path.push(endPt);
  return path;
}

export function cumulativeDistances(path) {
  const dists = [0];
  for (let i = 1; i < path.length; i++) {
    dists.push(dists[i - 1] + haversineDist(
      path[i - 1][0], path[i - 1][1],
      path[i][0], path[i][1]
    ));
  }
  return dists;
}

function segmentBearing(p1, p2) {
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const rlat1 = p1[0] * Math.PI / 180;
  const rlat2 = p2[0] * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(rlat2);
  const x = Math.cos(rlat1) * Math.sin(rlat2) - Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

export function walkAlongTrack(lineCoords, snap, distMeters) {
  const si = snap.segmentIndex;
  const startPt = snap.position;

  if (distMeters >= 0) {
    const segEnd = [lineCoords[si + 1][1], lineCoords[si + 1][0]];
    const distToSegEnd = haversineDist(startPt[0], startPt[1], segEnd[0], segEnd[1]);
    if (distMeters <= distToSegEnd) {
      const frac = distToSegEnd === 0 ? 0 : distMeters / distToSegEnd;
      return [
        startPt[0] + frac * (segEnd[0] - startPt[0]),
        startPt[1] + frac * (segEnd[1] - startPt[1]),
      ];
    }
    let remaining = distMeters - distToSegEnd;
    for (let i = si + 1; i < lineCoords.length - 1; i++) {
      const p1 = [lineCoords[i][1], lineCoords[i][0]];
      const p2 = [lineCoords[i + 1][1], lineCoords[i + 1][0]];
      const segLen = haversineDist(p1[0], p1[1], p2[0], p2[1]);
      if (remaining <= segLen) {
        const frac = segLen === 0 ? 0 : remaining / segLen;
        return [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1])];
      }
      remaining -= segLen;
    }
    const last = lineCoords[lineCoords.length - 1];
    return [last[1], last[0]];
  } else {
    const segStart = [lineCoords[si][1], lineCoords[si][0]];
    const distToSegStart = haversineDist(startPt[0], startPt[1], segStart[0], segStart[1]);
    const absDist = -distMeters;
    if (absDist <= distToSegStart) {
      const frac = distToSegStart === 0 ? 0 : absDist / distToSegStart;
      return [
        startPt[0] + frac * (segStart[0] - startPt[0]),
        startPt[1] + frac * (segStart[1] - startPt[1]),
      ];
    }
    let remaining = absDist - distToSegStart;
    for (let i = si - 1; i >= 0; i--) {
      const p1 = [lineCoords[i + 1][1], lineCoords[i + 1][0]];
      const p2 = [lineCoords[i][1], lineCoords[i][0]];
      const segLen = haversineDist(p1[0], p1[1], p2[0], p2[1]);
      if (remaining <= segLen) {
        const frac = segLen === 0 ? 0 : remaining / segLen;
        return [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1])];
      }
      remaining -= segLen;
    }
    const first = lineCoords[0];
    return [first[1], first[0]];
  }
}

export function dualSnapBearing(lineCoords, snap, halfDistMeters) {
  const front = walkAlongTrack(lineCoords, snap, halfDistMeters);
  const back = walkAlongTrack(lineCoords, snap, -halfDistMeters);
  return segmentBearing(back, front);
}

export function interpolateAlongPath(path, dists, t) {
  if (path.length < 2) return { position: path[0] || [0, 0], bearing: 0 };

  const totalDist = dists[dists.length - 1];
  if (totalDist === 0) return { position: path[0], bearing: segmentBearing(path[0], path[path.length - 1]) };

  const targetDist = Math.max(0, Math.min(1, t)) * totalDist;

  let seg = 0;
  for (let i = 1; i < dists.length; i++) {
    if (dists[i] >= targetDist) { seg = i - 1; break; }
    seg = i - 1;
  }

  const segLen = dists[seg + 1] - dists[seg];
  const segT = segLen === 0 ? 0 : (targetDist - dists[seg]) / segLen;

  const lat = path[seg][0] + segT * (path[seg + 1][0] - path[seg][0]);
  const lng = path[seg][1] + segT * (path[seg + 1][1] - path[seg][1]);

  return { position: [lat, lng], bearing: segmentBearing(path[seg], path[seg + 1]) };
}
