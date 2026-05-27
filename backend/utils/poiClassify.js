/**
 * Backend POI type classifier.
 *
 * Mirrors the core of frontend/src/utils/iconUtils.js
 * getDestinationIconTypeFromConfig: match the POI name against each icon's
 * title_keywords (whole word), then fall back to matching primary_activities
 * against activity_fallbacks. Used by news/events collection to skip POIs whose
 * type is excluded (e.g. playground, restroom).
 *
 * The role-based shortcuts (mtb/trail/etc.) from the frontend are intentionally
 * omitted — collection only operates on point/organization/river POIs.
 */

function matchesWholeWord(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * @param {string} name - POI name
 * @param {string} primaryActivities - comma-separated activities (pois.primary_activities is TEXT)
 * @param {Array<{name:string,title_keywords?:string,activity_fallbacks?:string,enabled?:boolean}>} iconConfig
 *   MUST be ordered by sort_order ascending (classification priority): the first
 *   matching icon wins, so callers query `ORDER BY sort_order, name`.
 * @returns {string} icon/type name, or 'default'
 */
export function classifyPoiType(name, primaryActivities, iconConfig) {
  if (!Array.isArray(iconConfig) || iconConfig.length === 0) return 'default';

  const poiName = (name || '').toLowerCase();
  const poiActivities = (primaryActivities || '').toLowerCase();

  for (const icon of iconConfig) {
    if (icon.enabled === false || !icon.title_keywords) continue;
    for (const keyword of icon.title_keywords.split(',')) {
      const k = keyword.trim().toLowerCase();
      if (k && matchesWholeWord(poiName, k)) return icon.name;
    }
  }

  for (const icon of iconConfig) {
    if (icon.enabled === false || !icon.activity_fallbacks) continue;
    for (const activity of icon.activity_fallbacks.split(',')) {
      const a = activity.trim().toLowerCase();
      if (a && matchesWholeWord(poiActivities, a)) return icon.name;
    }
  }

  return 'default';
}
