import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Capture console logs
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    console.log('[BROWSER]', text);
  });

  console.log('Test: Click East Rim Trail from MTB list');
  console.log('1. Navigating to /mtb-trail-status...');

  await page.goto('http://localhost:8080/mtb-trail-status', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  console.log('2. Waiting for MTB list to load...');
  await page.waitForTimeout(2000);

  // Check if list is visible
  const listVisible = await page.evaluate(() => {
    const resultsTiles = document.querySelectorAll('.results-tile');
    return resultsTiles.length > 0;
  });

  console.log(`   MTB list visible: ${listVisible}`);

  console.log('3. Getting initial map state...');
  const initialState = await page.evaluate(() => {
    const mapContainer = document.querySelector('.leaflet-container');
    const mapObj = mapContainer?._leaflet_map;
    return {
      hasMapObject: !!mapObj,
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter()
    };
  });
  console.log('   Initial map:', initialState);

  console.log('4. Clicking on East Rim Trail tile...');

  // Find and click the East Rim Trail tile
  const clicked = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.results-tile'));
    const eastRimTile = tiles.find(tile => {
      const name = tile.querySelector('.results-tile-name')?.textContent || '';
      return name.toLowerCase().includes('east rim');
    });

    if (eastRimTile) {
      eastRimTile.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log('❌ Could not find East Rim Trail tile');
    await browser.close();
    return;
  }

  console.log('5. Waiting for navigation and zoom...');
  await page.waitForTimeout(3000);

  console.log('6. Getting final map state...');
  const finalState = await page.evaluate(() => {
    const mapContainer = document.querySelector('.leaflet-container');
    const mapObj = mapContainer?._leaflet_map;
    return {
      pathname: window.location.pathname,
      hasMapObject: !!mapObj,
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter(),
      activeTab: document.querySelector('.sidebar-tab.active')?.textContent.trim()
    };
  });

  console.log('\n=== Results ===');
  console.log('URL:', finalState.pathname);
  console.log('Active tab:', finalState.activeTab);
  console.log('Map zoom:', finalState.zoom);
  console.log('Map center:', finalState.center);

  const expectedLat = 41.2635;
  const expectedLng = -81.5255;

  if (finalState.center) {
    const latClose = Math.abs(finalState.center.lat - expectedLat) < 0.01;
    const lngClose = Math.abs(finalState.center.lng - expectedLng) < 0.01;
    const zoomedIn = finalState.zoom >= 15;

    console.log('\nExpected: [41.2635, -81.5255] at zoom 15+');
    console.log('Lat match:', latClose);
    console.log('Lng match:', lngClose);
    console.log('Zoomed in:', zoomedIn);

    if (latClose && lngClose && zoomedIn) {
      console.log('\n✅ SUCCESS: Map zoomed correctly!');
    } else {
      console.log('\n❌ FAILED: Map did not zoom to POI');
    }
  } else {
    console.log('\n❌ FAILED: No map center');
  }

  console.log('\n=== Console Logs from Click ===');
  const relevantLogs = consoleLogs.filter(log =>
    log.includes('[MTB Click]') ||
    log.includes('[MapUpdater]') ||
    log.includes('[Browser Nav Effect]')
  );
  relevantLogs.forEach(log => console.log(log));

  console.log('\nPress Ctrl+C to close browser...');
  await page.waitForTimeout(30000);

  await browser.close();
})();
