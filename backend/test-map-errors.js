import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  const errors = [];
  const warnings = [];
  const consoleLogs = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      errors.push(text);
    } else if (msg.type() === 'warning') {
      warnings.push(text);
    } else if (text.includes('MapContainer') || text.includes('Leaflet') || text.includes('map')) {
      consoleLogs.push(`[${msg.type()}] ${text}`);
    }
  });

  page.on('pageerror', error => {
    errors.push(`PAGE ERROR: ${error.message}`);
  });

  console.log('Navigating to home page...');
  await page.goto('http://localhost:8080/', {
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

  console.log('\n=== RELEVANT CONSOLE LOGS ===');
  if (consoleLogs.length > 0) {
    consoleLogs.forEach(l => console.log('  ', l));
  } else {
    console.log('  None');
  }

  const mapState = await page.evaluate(() => {
    const mapContainer = document.querySelector('.leaflet-container');
    const mapElement = document.querySelector('#map');
    const mainContent = document.querySelector('.main-content');
    const mapObj = mapContainer?._leaflet_map;

    return {
      hasLeafletContainer: !!mapContainer,
      leafletContainerClasses: mapContainer?.className,
      hasMapElement: !!mapElement,
      hasMainContent: !!mainContent,
      mainContentDisplay: mainContent ? window.getComputedStyle(mainContent).display : null,
      mainContentZIndex: mainContent ? window.getComputedStyle(mainContent).zIndex : null,
      hasMapObject: !!mapObj,
      mapObjectKeys: mapObj ? Object.keys(mapObj).slice(0, 10) : []
    };
  });

  console.log('\n=== MAP STATE ===');
  console.log('Has .leaflet-container:', mapState.hasLeafletContainer);
  console.log('Container classes:', mapState.leafletContainerClasses);
  console.log('Has #map:', mapState.hasMapElement);
  console.log('Has .main-content:', mapState.hasMainContent);
  console.log('Main content display:', mapState.mainContentDisplay);
  console.log('Main content z-index:', mapState.mainContentZIndex);
  console.log('Has map object:', mapState.hasMapObject);
  if (mapState.hasMapObject) {
    console.log('Map object keys:', mapState.mapObjectKeys);
  }

  await browser.close();
})();
