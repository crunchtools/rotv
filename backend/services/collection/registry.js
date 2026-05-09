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
  {
    id: 'news_daily',
    label: 'News & Events (Daily)',
    description: 'Daily collection for POIs with dedicated URLs + high-value POIs',
    icon: '\u{1F4F0}',
    promptKeys: [{
      key: 'news_collection_prompt',
      label: 'News Collection Prompt',
      placeholders: ['{{name}}', '{{poi_roles}}', '{{timezone}}', '{{website}}', '{{eventsUrl}}', '{{newsUrl}}']
    }],
    scheduleJobName: 'news-collection-daily',
    schedule: '0 6 * * *',
    statusTable: 'news_job_status',
    historyTypes: ['news', 'news_single', 'events_single'],
    triggerEndpoint: '/api/admin/news/collect?tier=daily',
    manualTriggerMethod: 'POST',
    hasPrompt: true
  },
  {
    id: 'news_weekly',
    label: 'News & Events (Weekly)',
    description: 'Weekly collection for active parks, landmarks, and organizations',
    icon: '\u{1F4F0}',
    promptKeys: [],
    scheduleJobName: 'news-collection-weekly',
    schedule: '0 6 * * 1',
    statusTable: 'news_job_status',
    historyTypes: ['news'],
    triggerEndpoint: '/api/admin/news/collect?tier=weekly',
    manualTriggerMethod: 'POST',
    hasPrompt: false
  },
  {
    id: 'news_monthly',
    label: 'News & Events (Monthly)',
    description: 'Monthly collection for low-activity and static POIs',
    icon: '\u{1F4F0}',
    promptKeys: [],
    scheduleJobName: 'news-collection-monthly',
    schedule: '0 6 1 * *',
    statusTable: 'news_job_status',
    historyTypes: ['news'],
    triggerEndpoint: '/api/admin/news/collect?tier=monthly',
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
    label: 'Newsletter Digest',
    description: 'Weekly email digest sent every Friday at 8 AM',
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
    case 'news_collection_prompt':
      return null;
    case 'trail_status_prompt': {
      const { TRAIL_STATUS_PROMPT } = await import('../trailStatusService.js');
      return TRAIL_STATUS_PROMPT;
    }
    default:
      return null;
  }
}
