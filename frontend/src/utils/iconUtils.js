export function matchesWholeWord(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

export function getDestinationIconTypeFromConfig(destination, iconConfig) {
  if (!iconConfig || iconConfig.length === 0) {
    return 'default';
  }

  if (destination.poi_roles?.includes('mtb_trail') || (destination.status_url && destination.status_url.trim() !== '')) {
    return 'mtb-trailhead';
  }

  const destinationName = (destination.name || '').toLowerCase();
  const destinationActivities = (destination.primary_activities || '').toLowerCase();

  for (const icon of iconConfig) {
    if (icon.enabled === false) continue;
    if (!icon.title_keywords) continue;

    const keywords = icon.title_keywords.split(',').map(k => k.trim().toLowerCase());
    for (const keyword of keywords) {
      if (keyword && matchesWholeWord(destinationName, keyword)) {
        return icon.name;
      }
    }
  }

  for (const icon of iconConfig) {
    if (icon.enabled === false) continue;
    if (!icon.activity_fallbacks) continue;

    const activities = icon.activity_fallbacks.split(',').map(a => a.trim().toLowerCase());
    for (const activity of activities) {
      if (activity && matchesWholeWord(destinationActivities, activity)) {
        return icon.name;
      }
    }
  }

  return 'default';
}

export function poiMatchesActivityForTypes(poi, visibleTypes, iconConfig) {
  if (!iconConfig || iconConfig.length === 0) return false;
  const poiActivities = (poi.primary_activities || '').toLowerCase();
  if (!poiActivities) return false;

  for (const icon of iconConfig) {
    if (icon.enabled === false) continue;
    if (!visibleTypes.has(icon.name)) continue;
    if (!icon.activity_fallbacks) continue;

    const fallbacks = icon.activity_fallbacks.split(',').map(a => a.trim().toLowerCase());
    for (const fb of fallbacks) {
      if (fb && matchesWholeWord(poiActivities, fb)) return true;
    }
  }
  return false;
}

/**
 * True when the legend is narrowed to a subset of activity-bearing types
 * (e.g. just "Biking") rather than showing everything. The Trails layer is only
 * refined by activity while this is true; with all (or no) activity types
 * selected it stays all-or-nothing, preserving plain "show me the trails" browsing.
 */
export function isActivityFilterActive(visibleTypes, iconConfig) {
  if (!iconConfig || iconConfig.length === 0) return false;
  let activityTypes = 0, selected = 0;
  for (const icon of iconConfig) {
    if (icon.enabled === false || !icon.activity_fallbacks) continue;
    activityTypes++;
    if (visibleTypes.has(icon.name)) selected++;
  }
  return selected > 0 && selected < activityTypes;
}

/**
 * Whether a trail (linear feature) should render given the current activity
 * narrowing. Untagged trails always show, so a missing tag never silently hides a
 * trail. (Selecting "Biking" hides hiking-only trails.)
 */
export function trailPassesActivityFilter(feature, visibleTypes, iconConfig) {
  if (!isActivityFilterActive(visibleTypes, iconConfig)) return true;
  if (!(feature.primary_activities || '').trim()) return true;
  return poiMatchesActivityForTypes(feature, visibleTypes, iconConfig);
}

export function getIconUrlForPOI(poi, iconConfig, poiType) {
  if (poiType === 'trail') return '/icons/layers/trails.svg';
  if (poiType === 'river') return '/icons/layers/rivers.svg';
  if (poiType === 'boundary') return '/icons/layers/boundaries.svg';
  if (poiType === 'virtual') return '/icons/thumbnails/virtual.svg';
  if (poiType === 'mtb') return '/icons/mtb-trailhead.svg';

  const iconType = getDestinationIconTypeFromConfig(poi, iconConfig);
  const icon = iconConfig?.find(ic => ic.name === iconType);

  if (icon) {
    if (icon.svg_content) {
      return `/api/icons/${icon.name}.svg`;
    }
    return `/icons/${icon.svg_filename || `${icon.name}.svg`}`;
  }

  return '/icons/default.svg';
}
