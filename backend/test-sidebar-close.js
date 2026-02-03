import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Navigating to POI...');
  await page.goto('http://localhost:8080/cleveland-cliffs-bike-park', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const beforeClose = await page.evaluate(() => {
    return {
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar')
    };
  });

  console.log('Before close:');
  console.log('  URL:', beforeClose.pathname);
  console.log('  Sidebar visible:', beforeClose.sidebarVisible);

  // Click close button
  console.log('\nClicking close button...');
  const closeClicked = await page.evaluate(() => {
    const closeBtn = document.querySelector('.sidebar-close');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    return false;
  });

  if (closeClicked) {
    await page.waitForTimeout(1000);

    const afterClose = await page.evaluate(() => {
      return {
        pathname: window.location.pathname,
        sidebarVisible: !!document.querySelector('.sidebar')
      };
    });

    console.log('\nAfter close:');
    console.log('  URL:', afterClose.pathname);
    console.log('  Sidebar visible:', afterClose.sidebarVisible);

    if (afterClose.pathname === '/' && !afterClose.sidebarVisible) {
      console.log('\n✅ SUCCESS: Closing sidebar navigates to root path');
    } else {
      console.log('\n❌ FAILED: Closing sidebar did not navigate correctly');
    }
  } else {
    console.log('\n⚠️  Close button not found');
  }

  await browser.close();
})();
