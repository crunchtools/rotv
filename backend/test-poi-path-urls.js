import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Test 1: Direct URL navigation to POI with path-based URL');
  await page.goto('http://localhost:8080/cleveland-cliffs-bike-park', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  await page.waitForTimeout(2000);

  const directNavState = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const title = document.querySelector('.sidebar-title')?.textContent;
    return {
      sidebarVisible: !!sidebar && window.getComputedStyle(sidebar).display !== 'none',
      poiTitle: title,
      currentUrl: window.location.pathname
    };
  });

  console.log('Direct navigation results:');
  console.log('  Sidebar visible:', directNavState.sidebarVisible);
  console.log('  POI title:', directNavState.poiTitle);
  console.log('  Current URL:', directNavState.currentUrl);

  if (directNavState.sidebarVisible && directNavState.poiTitle?.includes('Cleveland-Cliffs')) {
    console.log('✅ Direct navigation works!');
  } else {
    console.log('❌ Direct navigation failed');
  }

  console.log('\nTest 2: Browser back button to root');
  await page.goBack();
  await page.waitForTimeout(1000);

  const backState = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    return {
      sidebarVisible: !!sidebar && window.getComputedStyle(sidebar).display !== 'none',
      currentUrl: window.location.pathname
    };
  });

  console.log('After back button:');
  console.log('  Sidebar visible:', backState.sidebarVisible);
  console.log('  Current URL:', backState.currentUrl);

  if (backState.currentUrl === '/' && !backState.sidebarVisible) {
    console.log('✅ Back button works!');
  } else {
    console.log('❌ Back button failed');
  }

  console.log('\nTest 3: Browser forward button back to POI');
  await page.goForward();
  await page.waitForTimeout(1000);

  const forwardState = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const title = document.querySelector('.sidebar-title')?.textContent;
    return {
      sidebarVisible: !!sidebar && window.getComputedStyle(sidebar).display !== 'none',
      poiTitle: title,
      currentUrl: window.location.pathname
    };
  });

  console.log('After forward button:');
  console.log('  Sidebar visible:', forwardState.sidebarVisible);
  console.log('  POI title:', forwardState.poiTitle);
  console.log('  Current URL:', forwardState.currentUrl);

  if (forwardState.currentUrl === '/cleveland-cliffs-bike-park' && forwardState.sidebarVisible) {
    console.log('✅ Forward button works!');
  } else {
    console.log('❌ Forward button failed');
  }

  console.log('\nTest 4: Click POI from map (programmatic navigation)');
  // First go back to home
  await page.goto('http://localhost:8080/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  await page.waitForTimeout(2000);

  // Click a marker on the map
  const markerClicked = await page.evaluate(() => {
    const markers = document.querySelectorAll('.leaflet-marker-icon');
    if (markers.length > 0) {
      markers[0].click();
      return true;
    }
    return false;
  });

  if (markerClicked) {
    await page.waitForTimeout(1000);

    const clickState = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      const title = document.querySelector('.sidebar-title')?.textContent;
      const url = window.location.pathname;
      return {
        sidebarVisible: !!sidebar && window.getComputedStyle(sidebar).display !== 'none',
        poiTitle: title,
        currentUrl: url,
        isPathBased: url.startsWith('/') && url !== '/' && !url.includes('?')
      };
    });

    console.log('After clicking map marker:');
    console.log('  Sidebar visible:', clickState.sidebarVisible);
    console.log('  POI title:', clickState.poiTitle);
    console.log('  Current URL:', clickState.currentUrl);
    console.log('  Is path-based URL:', clickState.isPathBased);

    if (clickState.sidebarVisible && clickState.isPathBased) {
      console.log('✅ Map click uses path-based URLs!');
    } else {
      console.log('❌ Map click failed to use path-based URLs');
    }
  } else {
    console.log('⚠️  No markers found to click');
  }

  await browser.close();
})();
