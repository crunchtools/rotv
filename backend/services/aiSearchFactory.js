/**
 * AI Search Factory
 * Provides a pluggable AI search system with support for multiple providers.
 *
 * Supports:
 * - Primary/fallback provider configuration
 * - Usage limits with automatic fallback
 * - Provider: Gemini and Perplexity Sonar
 *
 * Configuration is stored in admin_settings:
 * - ai_search_primary: 'gemini' or 'perplexity'
 * - ai_search_fallback: 'gemini', 'perplexity', or 'none'
 * - ai_search_primary_limit: number of requests before switching to fallback (0 = unlimited)
 */

import { generateTextWithCustomPrompt as geminiSearch } from './geminiService.js';
import { generateTextWithCustomPrompt as perplexitySearch } from './perplexityService.js';
import fs from 'fs';

// Debug logging helper
function debugLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}\n`;
  try {
    fs.appendFileSync('/tmp/logs/debug.log', logMessage);
  } catch (err) {
    // Ignore file write errors
  }
  console.log(message);
}

// Track usage per job session
let currentJobUsage = { gemini: 0, perplexity: 0 };
let currentJobErrors = { gemini429: 0, perplexity429: 0 };
let currentActiveProvider = null;

/**
 * Reset usage tracking for a new job
 */
export function resetJobUsage() {
  currentJobUsage = { gemini: 0, perplexity: 0 };
  currentJobErrors = { gemini429: 0, perplexity429: 0 };
  currentActiveProvider = null;
}

/**
 * Get current job usage statistics
 * @returns {Object} - Copy of current usage counts
 */
export function getJobUsage() {
  return { ...currentJobUsage };
}

/**
 * Get current job statistics including errors
 * @returns {Object} - { usage, errors, activeProvider }
 */
export function getJobStats() {
  return {
    usage: { ...currentJobUsage },
    errors: { ...currentJobErrors },
    activeProvider: currentActiveProvider
  };
}

/**
 * Record a 429 error for a provider
 * @param {string} provider - 'gemini' or 'perplexity'
 */
export function record429Error(provider) {
  if (provider === 'gemini') {
    currentJobErrors.gemini429++;
  } else if (provider === 'perplexity') {
    currentJobErrors.perplexity429++;
  }
}

/**
 * Get AI search configuration from admin_settings
 * @param {Pool} pool - Database connection pool
 * @returns {Object} - { primary, fallback, primaryLimit }
 */
async function getConfig(pool) {
  const result = await pool.query(`
    SELECT key, value FROM admin_settings
    WHERE key IN ('ai_search_primary', 'ai_search_fallback', 'ai_search_primary_limit')
  `);

  const config = {
    primary: 'perplexity',
    fallback: 'none',
    primaryLimit: 0
  };

  for (const row of result.rows) {
    if (row.key === 'ai_search_primary') config.primary = row.value;
    if (row.key === 'ai_search_fallback') config.fallback = row.value;
    if (row.key === 'ai_search_primary_limit') config.primaryLimit = parseInt(row.value) || 0;
  }

  return config;
}

/**
 * Generate text content using the configured AI search provider
 * Automatically handles fallback when primary limit is reached
 *
 * @param {Pool} pool - Database connection pool
 * @param {string} customPrompt - The prompt to send to the AI
 * @returns {Promise<{response: string, provider: string}>} - Generated text response and provider used
 */
export async function generateTextWithCustomPrompt(pool, customPrompt, options = {}) {
  const config = await getConfig(pool);
  debugLog(`[AI Search Factory] Config: primary=${config.primary}, fallback=${config.fallback}, limit=${config.primaryLimit}`);

  // Determine which provider to use (forceProvider overrides for extraction from crawled content)
  let provider = options.forceProvider || config.primary;
  const primaryUsage = currentJobUsage[config.primary] || 0;
  debugLog(`[AI Search Factory] Initial provider: ${provider}, usage: ${primaryUsage}`);

  // Check if we've exceeded the primary limit
  if (config.primaryLimit > 0 && primaryUsage >= config.primaryLimit) {
    if (config.fallback && config.fallback !== 'none') {
      console.log(`[AI Search] Primary limit reached (${primaryUsage}/${config.primaryLimit}), switching to fallback: ${config.fallback}`);
      provider = config.fallback;
    } else {
      console.log(`[AI Search] Primary limit reached (${primaryUsage}/${config.primaryLimit}), no fallback configured - continuing with primary`);
    }
  }

  // Log which provider we're using (only on first request)
  if (currentJobUsage.gemini === 0 && currentJobUsage.perplexity === 0) {
    console.log(`[AI Search] Using primary provider: ${config.primary}${config.fallback !== 'none' ? `, fallback: ${config.fallback}` : ''}`);
    if (config.primaryLimit > 0) {
      console.log(`[AI Search] Primary limit: ${config.primaryLimit} requests`);
    }
  }

  // Track active provider
  currentActiveProvider = provider;
  let usedProvider = provider; // Track which provider actually succeeded

  // Call the appropriate provider
  let result;
  try {
    if (provider === 'gemini') {
      currentJobUsage.gemini++;
      console.log(`[AI Search] Calling Gemini (request #${currentJobUsage.gemini})`);
      result = await geminiSearch(pool, customPrompt);
    } else {
      currentJobUsage.perplexity++;
      console.log(`[AI Search] Calling Perplexity (request #${currentJobUsage.perplexity})`);
      result = await perplexitySearch(pool, customPrompt);
    }
  } catch (error) {
    // Track 429 errors
    if (error.message && error.message.includes('429')) {
      record429Error(provider);
    }

    // If primary fails and we have a fallback, try the fallback
    if (provider === config.primary && config.fallback && config.fallback !== 'none') {
      console.log(`[AI Search] Primary provider (${provider}) failed: ${error.message}`);
      console.log(`[AI Search] Attempting fallback: ${config.fallback}`);

      const fallbackProvider = config.fallback;
      currentActiveProvider = fallbackProvider;
      usedProvider = fallbackProvider; // Update the provider that succeeded

      try {
        if (fallbackProvider === 'gemini') {
          currentJobUsage.gemini++;
          result = await geminiSearch(pool, customPrompt);
        } else {
          currentJobUsage.perplexity++;
          result = await perplexitySearch(pool, customPrompt);
        }
      } catch (fallbackError) {
        // Track 429 errors on fallback too
        if (fallbackError.message && fallbackError.message.includes('429')) {
          record429Error(fallbackProvider);
        }
        throw fallbackError;
      }
    } else {
      throw error; // Re-throw if no fallback available
    }
  }

  debugLog(`[AI Search Factory] Returning provider: ${usedProvider}`);
  return { response: result, provider: usedProvider };
}
