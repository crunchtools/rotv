/**
 * Test Twitter login credentials
 * This script validates that Twitter authentication works
 */

import pkg from 'pg';
const { Pool } = pkg;
import { chromium } from 'playwright';

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'rotv',
  password: process.env.PGPASSWORD || 'rotv',
  port: process.env.PGPORT || 5432,
});

async function testTwitterLogin() {
  let browser = null;

  try {
    // Get credentials from database
    console.log('📊 Fetching Twitter credentials from database...');
    const result = await pool.query(
      "SELECT key, value FROM admin_settings WHERE key IN ('twitter_username', 'twitter_password')"
    );

    const creds = {};
    result.rows.forEach(row => {
      creds[row.key] = row.value;
    });

    const username = creds['twitter_username'];
    const password = creds['twitter_password'];

    console.log('Username:', username ? '✓ SET' : '✗ NOT SET');
    console.log('Password:', password ? '✓ SET (length: ' + password.length + ')' : '✗ NOT SET');

    if (!username || !password) {
      console.error('❌ Credentials not configured in database');
      process.exit(1);
    }

    // Launch browser
    console.log('\n🌐 Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Go to Twitter login page
    console.log('🔐 Navigating to Twitter login page...');
    await page.goto('https://x.com/i/flow/login', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    // Take screenshot before login
    await page.screenshot({ path: '/tmp/twitter-login-step1.png' });
    console.log('📸 Screenshot saved: /tmp/twitter-login-step1.png');

    // Enter username
    console.log('\n👤 Entering username...');
    try {
      const usernameInput = await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
      console.log('✓ Username field found');
      await usernameInput.fill(username);
      await page.waitForTimeout(1000);

      await page.screenshot({ path: '/tmp/twitter-login-step2.png' });
      console.log('📸 Screenshot saved: /tmp/twitter-login-step2.png');

    } catch (err) {
      console.error('❌ Could not find username input field');
      console.error('Error:', err.message);

      // Save page content for debugging
      const html = await page.content();
      require('fs').writeFileSync('/tmp/twitter-login-page.html', html);
      console.log('💾 Page HTML saved to: /tmp/twitter-login-page.html');

      throw err;
    }

    // Click Next button
    console.log('⏭️  Clicking Next button...');
    try {
      const nextButton = await page.locator('button:has-text("Next")').first();
      await nextButton.click();
      await page.waitForTimeout(2000);

      console.log('Current URL after Next:', page.url());

      await page.screenshot({ path: '/tmp/twitter-login-step3.png' });
      console.log('📸 Screenshot saved: /tmp/twitter-login-step3.png');

    } catch (err) {
      console.error('❌ Could not click Next button');
      console.error('Error:', err.message);
      throw err;
    }

    // Enter password
    console.log('\n🔑 Entering password...');
    try {
      const passwordInput = await page.waitForSelector('input[name="password"]', { timeout: 10000 });
      console.log('✓ Password field found');
      await passwordInput.fill(password);
      await page.waitForTimeout(1000);

      await page.screenshot({ path: '/tmp/twitter-login-step4.png' });
      console.log('📸 Screenshot saved: /tmp/twitter-login-step4.png');

    } catch (err) {
      console.error('❌ Could not find password input field');
      console.error('Error:', err.message);

      // Check if there's an unusual activity check
      const pageText = await page.textContent('body');
      if (pageText.includes('unusual') || pageText.includes('verify') || pageText.includes('phone')) {
        console.error('\n⚠️  Twitter may be asking for additional verification (phone, email, etc.)');
        console.error('Page contains:', pageText.substring(0, 500));
      }

      const html = await page.content();
      require('fs').writeFileSync('/tmp/twitter-login-page2.html', html);
      console.log('💾 Page HTML saved to: /tmp/twitter-login-page2.html');

      throw err;
    }

    // Click Log in button
    console.log('🔓 Clicking Log in button...');
    try {
      const loginButton = await page.locator('button:has-text("Log in")').first();
      await loginButton.click();
      await page.waitForTimeout(3000);

      console.log('Current URL after login:', page.url());
      console.log('Page title:', await page.title());

      await page.screenshot({ path: '/tmp/twitter-login-step5.png' });
      console.log('📸 Screenshot saved: /tmp/twitter-login-step5.png');

    } catch (err) {
      console.error('❌ Could not click Log in button');
      console.error('Error:', err.message);
      throw err;
    }

    // Check if login was successful
    const finalUrl = page.url();
    const finalTitle = await page.title();

    console.log('\n🔍 Checking login result...');
    console.log('Final URL:', finalUrl);
    console.log('Final Title:', finalTitle);

    const isLoggedIn = finalUrl.includes('/home') ||
                       finalUrl.includes('/compose') ||
                       !finalUrl.includes('/flow/login');

    if (isLoggedIn) {
      console.log('\n✅ SUCCESS! Twitter login worked!');

      // Try to navigate to the CVNPmtb profile
      console.log('\n🔗 Testing profile access...');
      await page.goto('https://x.com/CVNPmtb', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const profileTitle = await page.title();
      const profileContent = await page.textContent('body');

      console.log('Profile title:', profileTitle);
      console.log('Profile loaded, content length:', profileContent.length);

      await page.screenshot({ path: '/tmp/twitter-profile.png' });
      console.log('📸 Profile screenshot: /tmp/twitter-profile.png');

      // Extract recent tweets
      const tweets = await page.evaluate(() => {
        const articles = document.querySelectorAll('article');
        const tweetData = [];

        articles.forEach((article, idx) => {
          if (idx < 5) { // First 5 tweets
            const text = article.innerText || '';
            const time = article.querySelector('time');
            const datetime = time ? time.getAttribute('datetime') : null;

            tweetData.push({
              text: text.substring(0, 200),
              datetime: datetime
            });
          }
        });

        return tweetData;
      });

      console.log('\n📝 Recent tweets found:', tweets.length);
      tweets.forEach((tweet, idx) => {
        console.log(`\nTweet ${idx + 1}:`);
        console.log('Date:', tweet.datetime);
        console.log('Text:', tweet.text);
      });

    } else {
      console.log('\n❌ FAILED! Login did not succeed');
      console.log('The page is still on the login flow');

      // Check for error messages
      const pageText = await page.textContent('body');
      console.log('\nPage content preview:', pageText.substring(0, 500));

      if (pageText.includes('wrong') || pageText.includes('incorrect') || pageText.includes('invalid')) {
        console.error('\n⚠️  Credentials may be incorrect');
      }

      if (pageText.includes('suspended') || pageText.includes('locked')) {
        console.error('\n⚠️  Account may be suspended or locked');
      }
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
    await pool.end();
  }
}

testTwitterLogin();
