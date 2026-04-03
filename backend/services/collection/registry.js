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
    id: 'news',
    label: 'News & Events',
    description: 'AI-powered news and event discovery for POIs',
    icon: '\u{1F4F0}',
    promptKeys: [{
      key: 'news_collection_prompt',
      label: 'News Collection Prompt',
      placeholders: ['{{name}}', '{{poi_type}}', '{{timezone}}', '{{website}}', '{{eventsUrl}}', '{{newsUrl}}']
    }],
    scheduleJobName: 'news-collection',
    schedule: '0 6 * * *',
    statusTable: 'news_job_status',
    historyTypes: ['news'],
    triggerEndpoint: '/api/admin/news/collect',
    manualTriggerMethod: 'POST',
    hasPrompt: true
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
    label: 'Moderation Sweep',
    description: 'Re-checks unscored items missed by per-item queue',
    icon: '\u{1F50D}',
    promptKeys: [],
    scheduleJobName: 'content-moderation-sweep',
    schedule: '*/15 * * * *',
    statusTable: null,
    historyTypes: ['moderation'],
    triggerEndpoint: null,
    manualTriggerMethod: null,
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
    id: 'moderation_item',
    label: 'AI Moderation',
    description: 'Scores new content with Gemini when inserted',
    icon: '\u{2696}',
    promptKeys: [],
    scheduleJobName: 'content-moderation',
    schedule: null,
    statusTable: null,
    historyTypes: ['moderation'],
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
  {
    id: 'cleanup',
    label: 'Content Cleanup',
    description: 'Deletes old news and past events',
    icon: '\u{1F9F9}',
    promptKeys: [],
    scheduleJobName: null,
    schedule: null,
    statusTable: null,
    historyTypes: ['cleanup'],
    triggerEndpoint: null,
    manualTriggerMethod: null,
    hasPrompt: false
  }
];

/**
 * Get the default (hardcoded) prompt for a given prompt key.
 * Lazy-imports the constants from service files to avoid circular dependencies.
 */
export async function getDefaultPrompt(key) {
  switch (key) {
    case 'news_collection_prompt': {
      const { NEWS_COLLECTION_PROMPT } = await import('../newsService.js');
      return NEWS_COLLECTION_PROMPT;
    }
    case 'trail_status_prompt': {
      const { TRAIL_STATUS_PROMPT } = await import('../trailStatusService.js');
      return TRAIL_STATUS_PROMPT;
    }
    default:
      return null;
  }
}
