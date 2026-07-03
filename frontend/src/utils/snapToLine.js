export function snapToLine(point, lineCoords) {
  if (!lineCoords || lineCoords.length < 2) return { position: point, bearing: 0 };

  const [px, py] = [point[1], point[0]];
  let bestDist = Infinity;
  let bestPoint = point;
  let bestSegIdx = 0;
  let bestT = 0;

  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [ax, ay] = [lineCoords[i][0], lineCoords[i][1]];
    const [bx, by] = [lineCoords[i + 1][0], lineCoords[i + 1][1]];

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dist = (px - cx) * (px - cx) + (py - cy) * (py - cy);

    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = [cy, cx];
      bestSegIdx = i;
      bestT = t;
    }
  }

  const [lon1, lat1] = lineCoords[bestSegIdx];
  const [lon2, lat2] = lineCoords[bestSegIdx + 1];
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const rlat1 = lat1 * Math.PI / 180;
  const rlat2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(rlat2);
  const x = Math.cos(rlat1) * Math.sin(rlat2) - Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLon);
  const bearing = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;

  return { position: bestPoint, bearing, segmentIndex: bestSegIdx, segmentT: bestT };
}
