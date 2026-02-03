import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false }); // Use visible browser
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Test: Direct navigation to POI URL (non-headless)');
  console.log('Navigating to /east-rim-trail...');

  await page.goto('http://localhost:8080/east-rim-trail', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  console.log('Waiting 5 seconds for map to initialize and zoom...');
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const mapContainer = document.querySelector('.leaflet-container');
    const mapObj = mapContainer?._leaflet_map;

    return {
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar'),
      hasMapContainer: !!mapContainer,
      hasMapObject: !!mapObj,
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter()
    };
  });

  console.log('\nResult:');
  console.log('  URL:', state.pathname);
  console.log('  Sidebar visible:', state.sidebarVisible);
  console.log('  Has map container:', state.hasMapContainer);
  console.log('  Has map object:', state.hasMapObject);
  console.log('  Zoom:', state.zoom);
  console.log('  Center:', state.center);

  if (state.hasMapObject) {
    const expectedLat = 41.2635;
    const expectedLng = -81.5255;

    const latClose = Math.abs(state.center.lat - expectedLat) < 0.01;
    const lngClose = Math.abs(state.center.lng - expectedLng) < 0.01;
    const zoomedIn = state.zoom >= 15;

    console.log('\nExpected East Rim coordinates: [41.2635, -81.5255]');
    console.log('Latitude match:', latClose);
    console.log('Longitude match:', lngClose);
    console.log('Zoomed to 15+:', zoomedIn);

    if (latClose && lngClose && zoomedIn) {
      console.log('\n✅ SUCCESS: Map initialized and zoomed correctly!');
    } else {
      console.log('\n⚠️  Map initialized but not zoomed to POI');
    }
  } else {
    console.log('\n❌ Map object not initialized');
  }

  console.log('\nPress Ctrl+C to close browser...');
  await page.waitForTimeout(30000); // Keep browser open for 30s

  await browser.close();
})();
