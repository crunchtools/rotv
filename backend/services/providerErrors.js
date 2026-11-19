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

  // By the prefix serperService and llmService put on their own errors: a body
  // further along can quote either name (#902 review)
  const provider = /^Serper API /.test(message) ? 'serper'
    : /^(?:OpenRouter |Invalid OpenRouter API key)/.test(message) ? 'openrouter' : 'unknown';
  const status = message.match(/\b(?:returned|\):) ?(\d{3})\b/)?.[1];

  // OpenRouter also answers 403 when a moderated model flags one input. That is
  // about the page being summarized, not the key, and the body quotes the page,
  // so nothing in it may be matched as a credit or key failure (#888)
  if (status === '403' && /moderation|flagged/i.test(message)) return null;

  if (/not enough credits|insufficient credits|out of credits|payment required/i.test(message) || status === '402') {
    return { provider, error_class: 'quota_exhausted' };
  }
  if (/invalid .*api key|api key not configured/i.test(message) || status === '401' || status === '403') {
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
    // Fix: a non-provider Error quoting "returned 403" must not page (#904)
    if (details && details.provider !== 'unknown') return { message: result.message, details };
  }
  return null;
}
