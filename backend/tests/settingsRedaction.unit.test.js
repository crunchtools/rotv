import { describe, it, expect } from 'vitest';
import { isSecretSetting } from '../utils/settingsRedaction.js';

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
