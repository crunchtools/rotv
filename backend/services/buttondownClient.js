import axios from 'axios';

const BUTTONDOWN_API_BASE = 'https://api.buttondown.email';

// Fail-closed: sending requires an explicit NEWSLETTER_SEND_ENABLED=true.
// A missing or unset variable means NO send, so a forgotten env file (the
// regression behind the triple [PREVIEW] emails, #440/#476) can never email
// real subscribers by default. Production sets the flag explicitly in its
// env file; dev/test set it to 'false' (or leave it unset).
export function isSendEnabled() {
  return process.env.NEWSLETTER_SEND_ENABLED === 'true';
}

let apiKeyCache = null;

async function getApiKey(pool) {
  if (apiKeyCache) {
    return apiKeyCache;
  }

  if (pool) {
    try {
      const settingRow = await pool.query(
        "SELECT value FROM admin_settings WHERE key = 'buttondown_api_key'"
      );
      if (settingRow.rows.length > 0 && settingRow.rows[0].value) {
        const rawKey = settingRow.rows[0].value;
        apiKeyCache = rawKey.replace(/[^\x20-\x7E]/g, '').trim();

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

  if (process.env.BUTTONDOWN_API_KEY) {
    const rawKey = process.env.BUTTONDOWN_API_KEY;
    apiKeyCache = rawKey.replace(/[^\x20-\x7E]/g, '').trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(apiKeyCache)) {
      console.error('Environment API key contains invalid characters');
      throw new Error('Invalid API key format in environment');
    }

    return apiKeyCache;
  }

  throw new Error('BUTTONDOWN_NOT_CONFIGURED');
}

export function clearApiKeyCache() {
  apiKeyCache = null;
}

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

export async function addSubscriber(email, pool = null) {
  if (!isSendEnabled()) {
    console.log('Newsletter send disabled (NEWSLETTER_SEND_ENABLED is not "true"), skipping addSubscriber');
    return { email, status: 'send_disabled', skipped: true };
  }

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
      console.error('Buttondown addSubscriber error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        email
      });

      const errorCode = error.response?.data?.code;
      const errorDetail = error.response?.data?.detail;

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

      if (error.response?.status === 400 && Array.isArray(errorDetail) && errorDetail[0]?.msg?.includes('already exists')) {
        console.log(`Subscriber ${email} already exists (array format), ignoring duplicate`);
        return { email, status: 'already_subscribed' };
      }

      throw error;
    }
  });
}

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

export async function sendEmail(subject, htmlBody, pool = null, { existingEmailId, onDraftCreated } = {}) {
  if (!isSendEnabled()) {
    console.log('Newsletter send disabled (NEWSLETTER_SEND_ENABLED is not "true"), skipping sendEmail');
    return { skipped: true, reason: 'send_disabled' };
  }

  const apiKey = await getApiKey(pool);

  let emailId;

  if (existingEmailId) {
    emailId = existingEmailId;
    console.log(`Resuming with existing draft: ${emailId}`);
  } else {
    console.log(`Creating draft email: "${subject}"`);

    let createResponse;
    try {
      const draftClient = createClient(apiKey);
      createResponse = await draftClient.post('/v1/emails', {
        subject,
        body: htmlBody,
        email_type: 'public'
      });
    } catch (error) {
      console.error(`Draft creation failed:`, error.response?.status, error.response?.data);
      throw error;
    }

    emailId = createResponse.data.id;
    console.log(`Created email draft: ${emailId}`);

    if (onDraftCreated) {
      await onDraftCreated(emailId);
    }
  }

  return retryRequest(async () => {
    // Buttondown rejects a publish_date at or before "now" (publish_date_invalid),
    // so schedule a few minutes out to satisfy its future-date requirement.
    const payload = {
      publish_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      status: 'scheduled'
    };

    console.log(`Scheduling email ${emailId} with payload:`, JSON.stringify(payload));

    try {
      const scheduleClient = createClient(apiKey);
      const sendResponse = await scheduleClient.patch(`/v1/emails/${emailId}`, payload);

      console.log(`Scheduled email for sending: ${emailId} (status: ${sendResponse.data.status})`);
      return sendResponse.data;
    } catch (error) {
      // Scrub the API token from the error so it never lands in logs or the
      // pg-boss job output (which serializes the thrown error's request config).
      if (error.config?.headers?.Authorization) {
        error.config.headers.Authorization = '[REDACTED]';
      }

      const errorDetails = {
        emailId,
        status: error.response?.status,
        statusText: error.response?.statusText,
        buttondownError: error.response?.data,
        requestPayload: payload
      };

      console.error(`Buttondown PATCH failed:`, JSON.stringify(errorDetails, null, 2));

      error.buttondownDetails = errorDetails;
      throw error;
    }
  });
}

export async function sendDraftToRecipients(subject, htmlBody, recipients, pool = null) {
  if (!isSendEnabled()) {
    console.log('Newsletter send disabled (NEWSLETTER_SEND_ENABLED is not "true"), skipping sendDraftToRecipients');
    return { emailId: null, skipped: true, reason: 'send_disabled' };
  }

  const apiKey = await getApiKey(pool);
  const client = createClient(apiKey);

  const createResponse = await client.post('/v1/emails', {
    subject,
    body: htmlBody,
    email_type: 'public'
  });
  const emailId = createResponse.data.id;

  await client.post(`/v1/emails/${emailId}/send-draft`, { recipients });
  return { emailId };
}

export async function listSubscribers(pool = null) {
  const apiKey = await getApiKey(pool);
  const client = createClient(apiKey);

  const subscribers = [];
  let url = '/v1/subscribers?status=regular';

  while (url) {
    const response = await client.get(url);
    const page = response.data;
    if (Array.isArray(page.results)) {
      for (const sub of page.results) {
        subscribers.push({
          email: sub.email_address,
          created: sub.creation_date,
        });
      }
    }
    url = page.next ? new URL(page.next).pathname + new URL(page.next).search : null;
  }

  return subscribers;
}

export async function testApiKey(pool = null) {
  const apiKey = await getApiKey(pool);
  const client = createClient(apiKey);

  try {
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
