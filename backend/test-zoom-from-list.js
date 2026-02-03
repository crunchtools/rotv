import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Navigating to MTB list...');
  await page.goto('http://localhost:8080/mtb-trail-status', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  // Get initial map state
  const initialState = await page.evaluate(() => {
    const mapElement = document.querySelector('.leaflet-container');
    const mapObj = mapElement?._leaflet_map;
    return {
      hasMap: !!mapObj,
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter()
    };
  });

  console.log('\nInitial map state (on Results tab):');
  console.log('  Has map object:', initialState.hasMap);
  console.log('  Zoom:', initialState.zoom);
  console.log('  Center:', initialState.center);

  // Click East Rim Trail
  console.log('\nClicking East Rim Trail from list...');
  const clicked = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.results-tile'));
    const eastRimTile = tiles.find(tile => tile.textContent.includes('East Rim'));
    if (eastRimTile) {
      eastRimTile.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log('❌ East Rim Trail not found');
    await browser.close();
    return;
  }

  // Wait for navigation and map update
  await page.waitForTimeout(1000);

  const afterClickState = await page.evaluate(() => {
    const mapElement = document.querySelector('.leaflet-container');
    const mapObj = mapElement?._leaflet_map;
    const activeTab = document.querySelector('.tab-btn.active')?.textContent;
    return {
      pathname: window.location.pathname,
      activeTab: activeTab,
      hasMap: !!mapObj,
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter(),
      sidebarVisible: !!document.querySelector('.sidebar')
    };
  });

  console.log('\nAfter clicking East Rim Trail (immediate):');
  console.log('  URL:', afterClickState.pathname);
  console.log('  Active tab:', afterClickState.activeTab);
  console.log('  Has map object:', afterClickState.hasMap);
  console.log('  Zoom:', afterClickState.zoom);
  console.log('  Center:', afterClickState.center);
  console.log('  Sidebar visible:', afterClickState.sidebarVisible);

  // Wait for fly animation to complete
  await page.waitForTimeout(1000);

  const finalState = await page.evaluate(() => {
    const mapElement = document.querySelector('.leaflet-container');
    const mapObj = mapElement?._leaflet_map;
    return {
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter()
    };
  });

  console.log('\nAfter fly animation should complete:');
  console.log('  Zoom:', finalState.zoom);
  console.log('  Center:', finalState.center);

  // East Rim Trail coordinates: 41.2635, -81.5255
  const expectedLat = 41.2635;
  const expectedLng = -81.5255;

  if (finalState.center) {
    const latClose = Math.abs(finalState.center.lat - expectedLat) < 0.01;
    const lngClose = Math.abs(finalState.center.lng - expectedLng) < 0.01;
    const zoomedIn = finalState.zoom >= 15;

    console.log('\nVerification:');
    console.log('  Expected center: [', expectedLat, ',', expectedLng, ']');
    console.log('  Actual center:   [', finalState.center.lat?.toFixed(4), ',', finalState.center.lng?.toFixed(4), ']');
    console.log('  Latitude match:', latClose);
    console.log('  Longitude match:', lngClose);
    console.log('  Zoomed to 15+:', zoomedIn);

    if (latClose && lngClose && zoomedIn) {
      console.log('\n✅ SUCCESS: Map zoomed to East Rim Trail!');
    } else {
      console.log('\n❌ FAILED: Map did not zoom correctly');
      if (!zoomedIn) {
        console.log('   - Zoom level too low (got', finalState.zoom, ', expected >= 15)');
      }
      if (!latClose || !lngClose) {
        console.log('   - Center not matching expected coordinates');
      }
    }
  } else {
    console.log('\n❌ FAILED: Map object not initialized');
  }

  await browser.close();
})();
