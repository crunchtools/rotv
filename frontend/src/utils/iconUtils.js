function matchesWholeWord(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

export function getDestinationIconTypeFromConfig(destination, iconConfig) {
  if (!iconConfig || iconConfig.length === 0) {
    return 'default';
  }

  if (destination.status_url && destination.status_url.trim() !== '') {
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
