import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const errors = [];
  const warnings = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    } else if (msg.type() === 'warning') {
      warnings.push(msg.text());
    }
  });

  page.on('pageerror', error => {
    errors.push(`PAGE ERROR: ${error.message}`);
  });

  console.log('Navigating to path-based POI URL...');
  await page.goto('http://localhost:8080/cleveland-cliffs-bike-park', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  await page.waitForTimeout(3000);

  console.log('\n=== ERRORS ===');
  if (errors.length > 0) {
    errors.forEach(e => console.log('  ', e));
  } else {
    console.log('  None');
  }

  console.log('\n=== WARNINGS ===');
  if (warnings.length > 0) {
    warnings.forEach(w => console.log('  ', w));
  } else {
    console.log('  None');
  }

  const pageState = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const sidebarTitle = document.querySelector('.sidebar h2')?.textContent ||
                         document.querySelector('.sidebar h3')?.textContent ||
                         document.querySelector('.sidebar-destination-name')?.textContent;
    const activeTab = document.querySelector('.tab-btn.active')?.textContent;

    return {
      url: window.location.href,
      pathname: window.location.pathname,
      sidebarExists: !!sidebar,
      sidebarVisible: !!sidebar && window.getComputedStyle(sidebar).display !== 'none',
      sidebarTitle: sidebarTitle,
      activeTab: activeTab,
      documentTitle: document.title
    };
  });

  console.log('\n=== PAGE STATE ===');
  console.log('URL:', pageState.url);
  console.log('Pathname:', pageState.pathname);
  console.log('Sidebar exists:', pageState.sidebarExists);
  console.log('Sidebar visible:', pageState.sidebarVisible);
  console.log('Sidebar title:', pageState.sidebarTitle);
  console.log('Active tab:', pageState.activeTab);
  console.log('Document title:', pageState.documentTitle);

  if (pageState.pathname === '/cleveland-cliffs-bike-park' &&
      pageState.sidebarVisible &&
      errors.length === 0) {
    console.log('\n✅ SUCCESS: Path-based URLs working correctly!');
  } else {
    console.log('\n❌ FAILED: Issues detected');
  }

  await browser.close();
})();
