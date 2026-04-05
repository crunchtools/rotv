import axios from 'axios';

const BUTTONDOWN_API_BASE = 'https://api.buttondown.email';

// In-memory cache for API key (refreshed from DB on each call)
let apiKeyCache = null;

/**
 * Get Buttondown API key from database or environment
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<string>} API key
 */
async function getApiKey(pool) {
  // Return cached key if available
  if (apiKeyCache) {
    return apiKeyCache;
  }

  // Try to get from database first
  if (pool) {
    try {
      const result = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'buttondown_api_key'"
      );
      if (result.rows.length > 0 && result.rows[0].value) {
        // Sanitize: keep only printable ASCII characters (no control chars)
        const rawKey = result.rows[0].value;
        apiKeyCache = rawKey.replace(/[^\x20-\x7E]/g, '').trim();

        // Validate format (should be alphanumeric, dashes, underscores only)
        if (!/^[a-zA-Z0-9_-]+$/.test(apiKeyCache)) {
          console.error('API key contains invalid characters. Key length:', apiKeyCache.length);
          console.error('First 10 chars:', apiKeyCache.substring(0, 10));
          throw new Error('Invalid API key format in database');
        }

        return apiKeyCache;
      }
    } catch (err) {
      console.error('Error fetching Buttondown API key from database:', err);
    }
  }

  // Fall back to environment variable
  if (process.env.BUTTONDOWN_API_KEY) {
    const rawKey = process.env.BUTTONDOWN_API_KEY;
    apiKeyCache = rawKey.replace(/[^\x20-\x7E]/g, '').trim();

    // Validate format
    if (!/^[a-zA-Z0-9_-]+$/.test(apiKeyCache)) {
      console.error('Environment API key contains invalid characters');
      throw new Error('Invalid API key format in environment');
    }

    return apiKeyCache;
  }

  throw new Error('BUTTONDOWN_NOT_CONFIGURED');
}

/**
 * Clear the API key cache (useful when settings change)
 */
export function clearApiKeyCache() {
  apiKeyCache = null;
}

/**
 * Create axios client with API key
 * @param {string} apiKey - Buttondown API key
 */
function createClient(apiKey) {
  return axios.create({
    baseURL: BUTTONDOWN_API_BASE,
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });
}

/**
 * Retry helper for API calls
 */
async function retryRequest(requestFn, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;
      console.error(`Buttondown API attempt ${attempt}/${maxRetries} failed:`, error.message);

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Add a subscriber to Buttondown
 * @param {string} email - Subscriber email address
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<Object>} Subscriber object from Buttondown
 */
export async function addSubscriber(email, pool = null) {
  const apiKey = await getApiKey(pool);
  const client = createClient(apiKey);

  return retryRequest(async () => {
    try {
      const response = await client.post('/v1/subscribers', {
        email_address: email,
        referrer_url: 'https://rootsofthevalley.org'
      });
      return response.data;
    } catch (error) {
      // Log detailed error for debugging
      console.error('Buttondown addSubscriber error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        email
      });

      const errorCode = error.response?.data?.code;
      const errorDetail = error.response?.data?.detail;

      // Handle already subscribed (both confirmed and unconfirmed)
      if (error.response?.status === 400 && (
        errorCode === 'email_already_exists' ||
        (errorDetail && typeof errorDetail === 'string' && errorDetail.includes('already subscribed'))
      )) {
        console.log(`Subscriber ${email} already exists (confirmed or pending confirmation)`);
        return {
          email,
          status: 'already_subscribed',
          needsConfirmation: errorDetail?.includes('has not confirmed')
        };
      }

      // Handle other 400 errors (includes validation, array detail format)
      if (error.response?.status === 400 && Array.isArray(errorDetail) && errorDetail[0]?.msg?.includes('already exists')) {
        console.log(`Subscriber ${email} already exists (array format), ignoring duplicate`);
        return { email, status: 'already_subscribed' };
      }

      throw error;
    }
  });
}

/**
 * Get total subscriber count from Buttondown
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<number>} Total number of active subscribers
 */
export async function getSubscriberCount(pool = null) {
  const apiKey = await getApiKey(pool);
  const client = createClient(apiKey);

  return retryRequest(async () => {
    const response = await client.get('/v1/subscribers');

    if (Array.isArray(response.data?.results)) {
      return response.data.count || response.data.results.length;
    }

    return 0;
  });
}

/**
 * Send email broadcast via Buttondown
 * @param {string} subject - Email subject line
 * @param {string} htmlBody - HTML email body
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<Object>} Email object from Buttondown
 */
export async function sendEmail(subject, htmlBody, pool = null) {
  const apiKey = await getApiKey(pool);

  // Step 1: Create draft email (outside retry to avoid duplicate drafts)
  console.log(`📧 Creating draft email: "${subject}"`);

  let createResponse;
  try {
    const draftClient = createClient(apiKey);
    createResponse = await draftClient.post('/v1/emails', {
      subject,
      body: htmlBody,
      email_type: 'public'
    });
  } catch (error) {
    console.error(`❌ Draft creation failed:`, error.response?.status, error.response?.data);
    throw error;
  }

  const emailId = createResponse.data.id;
  console.log(`✓ Created email draft: ${emailId}`);

  // Step 2: Schedule for immediate sending (with retry)
  return retryRequest(async () => {
    const payload = {
      publish_date: new Date().toISOString(),
      status: 'scheduled'
    };

    console.log(`🔄 Scheduling email ${emailId} with payload:`, JSON.stringify(payload));

    try {
      // Create fresh client for each retry attempt
      const scheduleClient = createClient(apiKey);
      const sendResponse = await scheduleClient.patch(`/v1/emails/${emailId}`, payload);

      console.log(`✓ Scheduled email for sending: ${emailId} (status: ${sendResponse.data.status})`);
      return sendResponse.data;
    } catch (error) {
      // Capture full error details for database logging
      const errorDetails = {
        emailId,
        status: error.response?.status,
        statusText: error.response?.statusText,
        buttondownError: error.response?.data,
        requestPayload: payload,
        requestHeaders: error.config?.headers
      };

      console.error(`❌ Buttondown PATCH failed:`, JSON.stringify(errorDetails, null, 2));

      // Attach error details to the error object so they can be logged to database
      error.buttondownDetails = errorDetails;
      throw error;
    }
  });
}

/**
 * Test Buttondown API key validity
 * @param {Pool} pool - Database connection pool
 * @returns {Promise<Object>} Test result with subscriber count
 */
export async function testApiKey(pool = null) {
  const apiKey = await getApiKey(pool);
  const client = createClient(apiKey);

  try {
    // Test by fetching subscriber list (simple GET that requires auth)
    const response = await client.get('/v1/subscribers');

    return {
      valid: true,
      subscriberCount: response.data.count || 0,
      message: 'API key is valid and working'
    };
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('Invalid API key - authentication failed');
    } else if (error.response?.status === 403) {
      throw new Error('API key lacks required permissions');
    } else {
      throw new Error(`Buttondown API error: ${error.message}`);
    }
  }
}
