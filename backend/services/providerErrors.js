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

  const serper = /Serper/i.test(message);
  const openrouter = /OpenRouter/i.test(message);
  const provider = serper ? 'serper' : openrouter ? 'openrouter' : 'unknown';
  const status = message.match(/\b(?:returned|\)\:) ?(\d{3})\b/)?.[1];

  if (/not enough credits|insufficient credits|out of credits|payment required/i.test(message) || status === '402') {
    return { provider, error_class: 'quota_exhausted' };
  }
  // OpenRouter also answers 403 when a moderated model flags one input; that is
  // about the page being summarized, not the key (#888)
  const flagged = /moderation|flagged/i.test(message);
  if (/invalid .*api key|api key not configured/i.test(message) || status === '401' || (status === '403' && !flagged)) {
    return { provider, error_class: 'auth_failed' };
  }
  return null;
}

/**
 * The first credit or auth failure among runConcurrent results, which hold an
 * Error for every page that threw. Those pages are otherwise dropped, so an
 * exhausted OpenRouter key would end the run with zero items and no trace (#888).
 * @param {Array<unknown>} results
 * @returns {{message: string, details: {provider: string, error_class: string}}|null}
 */
export function firstProviderFailure(results) {
  for (const result of results) {
    if (!(result instanceof Error)) continue;
    const details = classifyProviderError(result);
    if (details) return { message: result.message, details };
  }
  return null;
}
