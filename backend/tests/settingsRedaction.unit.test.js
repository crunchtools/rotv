import { describe, it, expect } from 'vitest';
import { isSecretSetting, redactSettingRow } from '../utils/settingsRedaction.js';

describe('isSecretSetting', () => {
  it('flags every credential stored in admin_settings', () => {
    for (const key of ['gemini_api_key', 'serper_api_key', 'buttondown_api_key', 'apify_api_token',
      'github_api_token', 'usft_sharing_token', 'twitter_cookies']) {
      expect(isSecretSetting(key)).toBe(true);
    }
  });

  it('leaves ordinary settings visible', () => {
    for (const key of ['digest_greeting', 'moderation_enabled', 'twitter_consecutive_failures',
      'buttondown_from_email', 'newsletter_preview_email', 'blocklist_urls']) {
      expect(isSecretSetting(key)).toBe(false);
    }
  });
});

describe('redactSettingRow', () => {
  const updated = '2026-09-24 12:00:00';

  it('replaces a secret value with an isSet flag', () => {
    const row = redactSettingRow({ key: 'github_api_token', value: 'github_pat_abc', updated_at: updated });
    expect(row).toEqual({ key: 'github_api_token', isSet: true, updated_at: updated });
    expect(JSON.stringify(row)).not.toContain('github_pat_abc');
  });

  it('reports an empty secret as not set', () => {
    expect(redactSettingRow({ key: 'serper_api_key', value: '', updated_at: updated }).isSet).toBe(false);
  });

  it('passes ordinary rows through unchanged', () => {
    const row = { key: 'digest_greeting', value: 'Hello Valley', updated_at: updated };
    expect(redactSettingRow(row)).toEqual(row);
  });
});
