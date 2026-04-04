import Perplexity from '@perplexity-ai/perplexity_ai';
import dotenv from 'dotenv';

dotenv.config();

// Note: Rate limiting is now handled at the dispatch level in newsService.js
// POIs are started one per second with unlimited concurrency

/**
 * Create Perplexity client with API key from environment
 * @returns {Perplexity} - Perplexity client instance
 */
export function createPerplexityClient() {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    throw new Error('PERPLEXITY_API_KEY not configured. Please add your API key to the .env file.');
  }

  return new Perplexity({
    apiKey: apiKey,
  });
}

/**
 * Generate text content using Perplexity with web search grounding
 * This is a drop-in replacement for Gemini's generateTextWithCustomPrompt
 *
 * @param {object} pool - Database connection pool (not used, kept for compatibility)
 * @param {string} customPrompt - The prompt to send to Perplexity
 * @returns {Promise<string>} - Generated text response
 */
export async function generateTextWithCustomPrompt(pool, customPrompt) {
  const client = createPerplexityClient();

  console.log(`Generating with Perplexity Sonar (${customPrompt.length} chars, with web search)`);

  try {
    const response = await client.chat.completions.create({
      model: 'sonar',
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: customPrompt
        }
      ],
    });

    const text = response.choices[0].message.content;
    console.log(`Perplexity response received (${text.length} chars)`);

    return text;
  } catch (error) {
    console.error('Perplexity API error:', error.message);
    throw new Error(`Perplexity API request failed: ${error.message}`);
  }
}

/**
 * Test API key validity with a simple request
 * @returns {Promise<string>} - Test response text
 */
export async function testApiKey() {
  const client = createPerplexityClient();

  try {
    const response = await client.chat.completions.create({
      model: 'sonar',
      messages: [
        {
          role: 'user',
          content: 'Respond with exactly: API key verified'
        }
      ],
    });

    return response.choices[0].message.content;
  } catch (error) {
    throw new Error(`API key test failed: ${error.message}`);
  }
}
