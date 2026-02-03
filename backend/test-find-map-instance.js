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
    const leafletId = mapContainer?._leaflet_id;

    // Try to get the map from Leaflet's Util.stamp registry
    let mapFromUtil = null;
    if (window.L && leafletId) {
      // Leaflet stores objects in its Util registry
      // Try accessing through all possible Leaflet map instances
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        if (el._leaflet_map) {
          mapFromUtil = {
            zoom: el._leaflet_map.getZoom(),
            center: el._leaflet_map.getCenter(),
            element: el.className
          };
          break;
        }
      }
    }

    return {
      leafletId: leafletId,
      mapFromUtil: mapFromUtil,
      containerHasMap: !!mapContainer?._leaflet_map,
      leafletLoaded: !!window.L,
      // Check if useMap hook might have the instance
      reactLeafletContext: !!window.__REACT_LEAFLET_CONTEXT__
    };
  });

  console.log('Map instance search:');
  console.log('  Leaflet ID on container:', mapState.leafletId);
  console.log('  Found map on any element:', mapState.mapFromUtil ? 'Yes' : 'No');
  if (mapState.mapFromUtil) {
    console.log('    Element:', mapState.mapFromUtil.element);
    console.log('    Zoom:', mapState.mapFromUtil.zoom);
    console.log('    Center:', mapState.mapFromUtil.center);
  }
  console.log('  Leaflet loaded:', mapState.leafletLoaded);

  if (mapState.mapFromUtil) {
    console.log('\n✅ Found Leaflet map instance!');
    console.log('The map IS working, but Puppeteer test was looking in wrong place.');
  } else {
    console.log('\n❌ No Leaflet map instance found anywhere in DOM');
  }

  await browser.close();
})();
