import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Direct navigation to normal POI
  console.log('=== Test 1: Direct navigation to normal POI ===');
  await page.goto('http://localhost:8080/cleveland-cliffs-bike-park', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const test1 = await page.evaluate(() => {
    return {
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar'),
      title: document.title
    };
  });

  if (test1.pathname === '/cleveland-cliffs-bike-park' &&
      test1.sidebarVisible &&
      test1.title.includes('Cleveland-Cliffs')) {
    console.log('✅ PASS: Normal POI path URL works');
    testsPassed++;
  } else {
    console.log('❌ FAIL: Normal POI path URL failed');
    console.log('   Expected: /cleveland-cliffs-bike-park');
    console.log('   Got:', test1.pathname);
    testsFailed++;
  }

  // Test 2: Navigate to home, sidebar should close
  console.log('\n=== Test 2: Navigate to home ===');
  await page.goto('http://localhost:8080/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const test2 = await page.evaluate(() => {
    return {
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar'),
      title: document.title
    };
  });

  if (test2.pathname === '/' &&
      !test2.sidebarVisible &&
      test2.title === 'Roots of The Valley') {
    console.log('✅ PASS: Home navigation clears POI');
    testsPassed++;
  } else {
    console.log('❌ FAIL: Home navigation failed');
    console.log('   Sidebar should be hidden, got:', test2.sidebarVisible);
    testsFailed++;
  }

  // Test 3: MTB mode still works
  console.log('\n=== Test 3: MTB trail path URL ===');
  await page.goto('http://localhost:8080/mtb-trail-status/east-rim-trail', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const test3 = await page.evaluate(() => {
    return {
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar'),
      title: document.title
    };
  });

  if (test3.pathname === '/mtb-trail-status/east-rim-trail' &&
      test3.sidebarVisible &&
      test3.title.includes('East Rim')) {
    console.log('✅ PASS: MTB trail path URL works');
    testsPassed++;
  } else {
    console.log('❌ FAIL: MTB trail path URL failed');
    console.log('   Expected: /mtb-trail-status/east-rim-trail');
    console.log('   Got:', test3.pathname);
    testsFailed++;
  }

  // Test 4: Map click creates path URL
  console.log('\n=== Test 4: Map click creates path URL ===');
  await page.goto('http://localhost:8080/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const markerClicked = await page.evaluate(() => {
    const markers = document.querySelectorAll('.leaflet-marker-icon');
    if (markers.length > 0) {
      markers[0].click();
      return true;
    }
    return false;
  });

  if (markerClicked) {
    await page.waitForTimeout(1500);

    const test4 = await page.evaluate(() => {
      const path = window.location.pathname;
      return {
        pathname: path,
        isPathBased: path.startsWith('/') && path !== '/' && !path.includes('?'),
        sidebarVisible: !!document.querySelector('.sidebar')
      };
    });

    if (test4.isPathBased && test4.sidebarVisible) {
      console.log('✅ PASS: Map click uses path-based URL:', test4.pathname);
      testsPassed++;
    } else {
      console.log('❌ FAIL: Map click did not use path-based URL');
      console.log('   Got:', test4.pathname);
      testsFailed++;
    }
  } else {
    console.log('⚠️  SKIP: No markers found to click');
  }

  // Test 5: Results tab click (if applicable)
  console.log('\n=== Test 5: Results tab navigation ===');
  await page.goto('http://localhost:8080/', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  // Click Results tab
  await page.click('button.tab-btn:has-text("Results")');
  await page.waitForTimeout(1000);

  // Click first result tile
  const tileClicked = await page.evaluate(() => {
    const tile = document.querySelector('.results-tile');
    if (tile) {
      tile.click();
      return true;
    }
    return false;
  });

  if (tileClicked) {
    await page.waitForTimeout(1500);

    const test5 = await page.evaluate(() => {
      const path = window.location.pathname;
      return {
        pathname: path,
        isPathBased: path.startsWith('/') && path !== '/' && !path.includes('?'),
        sidebarVisible: !!document.querySelector('.sidebar')
      };
    });

    if (test5.isPathBased && test5.sidebarVisible) {
      console.log('✅ PASS: Results tile uses path-based URL:', test5.pathname);
      testsPassed++;
    } else {
      console.log('❌ FAIL: Results tile did not use path-based URL');
      console.log('   Got:', test5.pathname);
      testsFailed++;
    }
  } else {
    console.log('⚠️  SKIP: No result tiles found to click');
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED!');
  } else {
    console.log('\n⚠️  SOME TESTS FAILED');
  }

  await browser.close();
})();
