import { firstGeometryPoint } from '../../utils/geo';

export function getNavigationStops(poi, isLinearFeature) {
  if (!poi) return null;

  const navLat = poi.navigation_latitude != null ? Number(poi.navigation_latitude) : null;
  const navLng = poi.navigation_longitude != null ? Number(poi.navigation_longitude) : null;
  if (Number.isFinite(navLat) && Number.isFinite(navLng)) {
    return [{ lat: navLat, lng: navLng }];
  }

  if (isLinearFeature) {
    if (poi.poi_roles?.includes('trail')) {
      const point = firstGeometryPoint(poi.geometry);
      return point ? [point] : null;
    }
    return null;
  }

  const lat = poi.latitude != null ? Number(poi.latitude) : null;
  const lng = poi.longitude != null ? Number(poi.longitude) : null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return [{ lat, lng }];
  }
  return null;
}

export function getOwnerClass(owner) {
  if (!owner) return 'owner-other';
  const ownerLower = owner.toLowerCase();
  if (ownerLower.includes('federal') || ownerLower.includes('nps')) return 'owner-federal';
  if (ownerLower.includes('private')) return 'owner-private';
  if (ownerLower.includes('local') || ownerLower.includes('metro') || ownerLower.includes('county')) return 'owner-local';
  return 'owner-other';
}

export function formatCoordinate(value, type) {
  if (value === null || value === undefined) return '';
  const num = parseFloat(value);
  if (isNaN(num)) return '';
  const absVal = Math.abs(num).toFixed(4);
  if (type === 'lat') {
    return `${absVal}° ${num >= 0 ? 'N' : 'S'}`;
  } else {
    return `${absVal}° ${num >= 0 ? 'E' : 'W'}`;
  }
}

/**
 * OSM visitor-info display labels (#7). Stored values mirror the OSM tag values
 * (wheelchair, fee); these map them to public-facing text. opening_hours is
 * shown verbatim and needs no mapping.
 */
export const WHEELCHAIR_LABELS = {
  yes: 'Accessible',
  designated: 'Designated accessible',
  limited: 'Limited',
  no: 'Not accessible'
};

export const FEE_LABELS = {
  yes: 'Yes',
  no: 'No',
  conditional: 'Varies'
};

const OH_DAYS = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
const OH_MONTHS = { Jan: 'Jan', Feb: 'Feb', Mar: 'Mar', Apr: 'Apr', May: 'May', Jun: 'Jun', Jul: 'Jul', Aug: 'Aug', Sep: 'Sep', Oct: 'Oct', Nov: 'Nov', Dec: 'Dec' };
const OH_DAY = 'Mo|Tu|We|Th|Fr|Sa|Su';
const OH_MON = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';

/**
 * Render an OpenStreetMap opening_hours string as friendly text, e.g.
 * "Mo-Su 09:30-17:00" -> "Daily 9:30am–5pm". Covers the grammar that appears in
 * CVNP-region OSM data (day/month ranges, multiple rules, bare times, 24/7). The
 * opening_hours spec is far larger than this; any rule it can't parse cleanly
 * (e.g. holiday exceptions like "Nov Th[4],Dec 25 off") makes it return the raw
 * string unchanged, so the visitor always sees something accurate.
 */
export function humanizeOpeningHours(raw) {
  if (!raw || typeof raw !== 'string') return raw || null;
  const text = raw.trim();
  if (text === '24/7') return 'Open 24/7';

  const fmtTime = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const h = +m[1], min = m[2];
    if (h === 24 && min === '00') return 'midnight';
    const meridiem = h < 12 || h === 24 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return min === '00' ? `${h12}${meridiem}` : `${h12}:${min}${meridiem}`;
  };
  const fmtDays = (spec) => spec.split(',').map((part) => {
    const [from, to] = part.split('-');
    return to ? `${OH_DAYS[from]}–${OH_DAYS[to]}` : OH_DAYS[from];
  }).join(', ');
  const fmtMonths = (spec) => {
    const [from, to] = spec.split('-');
    return to ? `${OH_MONTHS[from]}–${OH_MONTHS[to]}` : OH_MONTHS[from];
  };

  const out = [];
  for (let rule of text.split(';').map((s) => s.trim()).filter(Boolean)) {
    let prefix = '';
    const mon = new RegExp(`^((?:${OH_MON})(?:-(?:${OH_MON}))?)\\s+(.*)$`).exec(rule);
    if (mon) { prefix = `${fmtMonths(mon[1])}: `; rule = mon[2]; }

    const day = new RegExp(`^((?:${OH_DAY})(?:[-,](?:${OH_DAY}))*)\\s+(.*)$`).exec(rule);
    let dayLabel = 'Daily', times = rule;
    if (day) { dayLabel = day[1] === 'Mo-Su' ? 'Daily' : fmtDays(day[1]); times = day[2]; }

    if (/^(off|closed)$/i.test(times.trim())) { out.push(`${prefix}${dayLabel}: Closed`); continue; }

    const spans = [];
    for (const span of times.split(',').map((s) => s.trim())) {
      const m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(span);
      const from = m && fmtTime(m[1]), to = m && fmtTime(m[2]);
      if (!from || !to) return raw; // unparseable rule -> safe fallback to the raw OSM string
      spans.push(`${from}–${to}`);
    }
    out.push(`${prefix}${dayLabel} ${spans.join(', ')}`);
  }
  return out.join(' · ');
}

export function generateSlug(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
