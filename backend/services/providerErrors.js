// Classifies failures from the paid providers (Serper search, OpenRouter AI) so
// collection health can tell "out of credits / bad key" from a transient error.

/**
 * @param {Error|string|null} error error thrown by serperService or llmService
 * @returns {{provider: 'serper'|'openrouter'|'unknown', error_class: 'quota_exhausted'|'auth_failed'}|null}
 *   the job_logs details to record; null when the error is not a credit or auth failure
 */
export function classifyProviderError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  if (!message) return null;

  const serper = /Serper API error/i.test(message);
  const openrouter = /OpenRouter/i.test(message);
  const provider = serper ? 'serper' : openrouter ? 'openrouter' : 'unknown';
  const status = message.match(/\b(?:returned|\)\:) ?(\d{3})\b/)?.[1];

  if (/not enough credits|insufficient credits|out of credits|payment required/i.test(message) || status === '402') {
    return { provider, error_class: 'quota_exhausted' };
  }
  if (/invalid .*api key/i.test(message) || status === '401' || status === '403') {
    return { provider, error_class: 'auth_failed' };
  }
  return null;
}
