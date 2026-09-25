/**
 * Collection Type Registry
 * Static registry of all data collection types with metadata.
 * Used by the admin UI to display collection type info, manage prompt templates,
 * and provide trigger/schedule configuration for the Jobs dashboard.
 *
 * historyTypes: array of job_type values used in job_logs / status tables.
 * The Jobs dashboard uses these to fetch per-job-type history inline.
 */

export const COLLECTION_TYPES = [
  // Current News, Historical News, and Events replace the daily/weekly/monthly tier
  // jobs (spec 044). historySubType narrows the shared 'news' history to one pipeline.
  {
    id: 'current_news',
    label: 'Current News',
    description: 'Daily: POI news pages + Google News (past month) for POIs whose tier cadence is due',
    icon: '\u{1F4F0}',
    promptKeys: [],
    scheduleJobName: 'news-current',
    schedule: '0 6 * * *',
    statusTable: 'news_job_status',
    historyTypes: ['news', 'news_single'],
    historySubType: 'current_news',
    triggerEndpoint: '/api/admin/news/collect?pipeline=current_news',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'historical_news',
    label: 'Historical News',
    description: 'Monthly: web search for the history of each POI, a few URLs per run; stops per POI once it runs dry',
    icon: '\u{1F3DB}\u{FE0F}',
    promptKeys: [],
    scheduleJobName: 'news-historical',
    schedule: '0 2 15 * *',
    statusTable: 'news_job_status',
    historyTypes: ['news'],
    historySubType: 'historical_news',
    triggerEndpoint: '/api/admin/news/collect?pipeline=historical_news',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'events',
    label: 'Events',
    description: 'Daily: events pages for POIs that have one',
    icon: '\u{1F4C5}',
    promptKeys: [],
    scheduleJobName: 'events-collection',
    schedule: '30 4 * * *',
    statusTable: 'news_job_status',
    historyTypes: ['news', 'events_single'],
    historySubType: 'events',
    triggerEndpoint: '/api/admin/news/collect?pipeline=events',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'trail_status',
    label: 'MTB Trail Status',
    description: 'Page rendering + AI extraction for trail conditions',
    icon: '\u{1F6B5}',
    promptKeys: [{
      key: 'trail_status_prompt',
      label: 'Trail Status Extraction Prompt',
      placeholders: ['{{name}}', '{{trailSystem}}', '{{currentDate}}', '{{timezone}}', '{{statusUrl}}', '{{renderedContent}}']
    }],
    scheduleJobName: 'trail-status-collection',
    schedule: '*/30 * * * *',
    statusTable: 'trail_status_job_status',
    historyTypes: ['trail_status'],
    triggerEndpoint: '/api/admin/trail-status/collect-batch',
    manualTriggerMethod: 'POST',
    hasPrompt: true
  },
  {
    id: 'river_levels',
    label: 'River Levels',
    description: 'Fetches USGS gauge readings (gage height + discharge) for river POIs',
    icon: '\u{1F30A}',
    promptKeys: [],
    scheduleJobName: 'river-levels-collection',
    schedule: '*/30 * * * *',
    statusTable: null,
    historyTypes: ['river_levels'],
    triggerEndpoint: '/api/admin/river-levels/collect',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'moderation_sweep',
    label: 'Content Moderation',
    description: 'Scores pending content with Gemini (every 15 min)',
    icon: '\u{1F50D}',
    promptKeys: [],
    scheduleJobName: 'content-moderation-sweep',
    schedule: '0 7 * * *',
    statusTable: null,
    historyTypes: ['moderation'],
    triggerEndpoint: '/api/admin/moderation/sweep',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'newsletter',
    label: 'Email Ingestion',
    description: 'Extracts news and events from inbound newsletters',
    icon: '\u{1F4E7}',
    promptKeys: [],
    scheduleJobName: 'newsletter-process',
    schedule: null,
    statusTable: null,
    historyTypes: ['newsletter'],
    triggerEndpoint: null,
    manualTriggerMethod: null,
    hasPrompt: false
  },
  {
    id: 'newsletter_digest',
    label: 'Newsletter Digest (Production)',
    description: 'Weekly email digest sent every Friday at 8 AM to all subscribers',
    icon: '\u{1F4E7}',
    promptKeys: [],
    scheduleJobName: 'newsletter-digest',
    schedule: '0 8 * * 5',
    statusTable: null,
    historyTypes: ['newsletter-digest'],
    triggerEndpoint: '/api/newsletter/send-digest',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'newsletter_preview',
    label: 'Newsletter Digest (Preview)',
    description: 'Thursday morning preview to the admin email in newsletter_preview_email — same content as Friday production send, 24 hours earlier',
    icon: '\u{1F4E7}',
    promptKeys: [],
    scheduleJobName: 'newsletter-preview',
    schedule: '0 8 * * 4',
    statusTable: null,
    historyTypes: ['newsletter-preview'],
    triggerEndpoint: '/api/newsletter/trigger-preview',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'image_backup',
    label: 'Image Server Backup',
    description: 'Syncs image server media files to Google Drive',
    icon: '\u{1F4BE}',
    promptKeys: [],
    scheduleJobName: 'image-backup',
    schedule: '0 2 * * *',
    statusTable: null,
    historyTypes: ['backup'],
    triggerEndpoint: null,
    manualTriggerMethod: null,
    hasPrompt: false
  },
  {
    id: 'database_backup',
    label: 'Database Backup',
    description: 'Uploads PostgreSQL dump to Google Drive',
    icon: '\u{1F5C4}',
    promptKeys: [],
    scheduleJobName: 'database-backup',
    schedule: '0 3 * * *',
    statusTable: null,
    historyTypes: ['database_backup'],
    triggerEndpoint: null,
    manualTriggerMethod: null,
    hasPrompt: false
  },
  {
    id: 'research',
    label: 'POI Research',
    description: 'Multi-pass AI research for POI metadata, descriptions, and hero images',
    icon: '\u{1F50D}',
    promptKeys: [{
      key: 'gemini_prompt_brief',
      label: 'Brief Description Prompt',
      placeholders: ['{{name}}', '{{era}}', '{{property_owner}}']
    }, {
      key: 'gemini_prompt_historical',
      label: 'Historical Description Prompt',
      placeholders: ['{{name}}', '{{era}}', '{{property_owner}}']
    }],
    scheduleJobName: null,
    schedule: null,
    statusTable: null,
    historyTypes: ['research'],
    triggerEndpoint: '/api/admin/ai/research-v2',
    manualTriggerMethod: 'POST',
    hasPrompt: true
  },
];

/**
 * Get the default (hardcoded) prompt for a given prompt key.
 * Lazy-imports the constants from service files to avoid circular dependencies.
 */
export async function getDefaultPrompt(key) {
  switch (key) {
    case 'trail_status_prompt': {
      const { TRAIL_STATUS_PROMPT } = await import('../trailStatusService.js');
      return TRAIL_STATUS_PROMPT;
    }
    default:
      return null;
  }
}
