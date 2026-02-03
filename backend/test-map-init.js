import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('Test 1: Navigate to home page first');
  await page.goto('http://localhost:8080/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  const homeState = await page.evaluate(() => {
    const mapElement = document.querySelector('.leaflet-container');
    const mapObj = mapElement?._leaflet_map;
    return {
      hasMapElement: !!mapElement,
      hasMapObj: !!mapObj,
      zoom: mapObj?.getZoom(),
      center: mapObj?.getCenter()
    };
  });

  console.log('  Home page map state:');
  console.log('    Has map element:', homeState.hasMapElement);
  console.log('    Has map object:', homeState.hasMapObj);
  console.log('    Zoom:', homeState.zoom);
  console.log('    Center:', homeState.center);

  console.log('\nTest 2: Now navigate to MTB list');
  await page.goto('http://localhost:8080/mtb-trail-status', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const mtbListState = await page.evaluate(() => {
    const mapElement = document.querySelector('.leaflet-container');
    const mapObj = mapElement?._leaflet_map;
    return {
      hasMapElement: !!mapElement,
      hasMapObj: !!mapObj,
      zoom: mapObj?.getZoom()
    };
  });

  console.log('  MTB list map state:');
  console.log('    Has map element:', mtbListState.hasMapElement);
  console.log('    Has map object:', mtbListState.hasMapObj);
  console.log('    Zoom:', mtbListState.zoom);

  console.log('\nTest 3: Click East Rim Trail');
  const clicked = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.results-tile'));
    const eastRimTile = tiles.find(tile => tile.textContent.includes('East Rim'));
    if (eastRimTile) {
      eastRimTile.click();
      return true;
    }
    return false;
  });

  if (clicked) {
    await page.waitForTimeout(2000);

    const afterClickState = await page.evaluate(() => {
      const mapElement = document.querySelector('.leaflet-container');
      const mapObj = mapElement?._leaflet_map;
      return {
        hasMapObj: !!mapObj,
        zoom: mapObj?.getZoom(),
        center: mapObj?.getCenter()
      };
    });

    console.log('  After clicking trail:');
    console.log('    Has map object:', afterClickState.hasMapObj);
    console.log('    Zoom:', afterClickState.zoom);
    console.log('    Center:', afterClickState.center);

    if (afterClickState.hasMapObj && afterClickState.zoom >= 15) {
      console.log('\n✅ Map zoomed correctly!');
    } else if (!afterClickState.hasMapObj) {
      console.log('\n❌ Map object still not initialized');
    } else {
      console.log('\n❌ Map not zoomed (zoom:', afterClickState.zoom, ')');
    }
  } else {
    console.log('  ❌ East Rim Trail not found');
  }

  await browser.close();
})();
