import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Navigating to home page...');
  await page.goto('http://localhost:8080/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });

  await page.waitForTimeout(3000);

  const mapState = await page.evaluate(() => {
    const mapContainer = document.querySelector('.leaflet-container');

    // Try different ways to access the Leaflet map
    const methods = {
      _leaflet_map: mapContainer?._leaflet_map,
      _leaflet_id: mapContainer?._leaflet_id,
      hasL: typeof window.L !== 'undefined',
      leafletVersion: window.L?.version
    };

    // If Leaflet is loaded, try to get maps from its registry
    if (window.L && window.L.Map) {
      // Get all Leaflet panes
      const panes = mapContainer?.querySelectorAll('.leaflet-pane');
      methods.panesCount = panes?.length || 0;
    }

    return methods;
  });

  console.log('Map access methods:');
  console.log('  _leaflet_map:', mapState._leaflet_map ? 'exists' : 'undefined');
  console.log('  _leaflet_id:', mapState._leaflet_id);
  console.log('  window.L exists:', mapState.hasL);
  console.log('  Leaflet version:', mapState.leafletVersion);
  console.log('  Leaflet panes count:', mapState.panesCount);

  if (!mapState._leaflet_map) {
    console.log('\n❌ Map instance not found via _leaflet_map');
    console.log('This suggests the MapContainer is not initializing Leaflet properly.');
  } else {
    console.log('\n✅ Map instance found');
  }

  await browser.close();
})();
