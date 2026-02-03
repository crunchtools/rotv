import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Navigate to MTB trail list
  console.log('=== Test 1: Navigate to MTB trail list ===');
  await page.goto('http://localhost:8080/mtb-trail-status', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const test1 = await page.evaluate(() => {
    const resultsTab = document.querySelector('.tab-btn.active')?.textContent;
    return {
      pathname: window.location.pathname,
      activeTab: resultsTab,
      hasTiles: document.querySelectorAll('.results-tile').length > 0
    };
  });

  if (test1.pathname === '/mtb-trail-status' &&
      test1.activeTab === 'Results' &&
      test1.hasTiles) {
    console.log('✅ PASS: MTB list page loads correctly');
    testsPassed++;
  } else {
    console.log('❌ FAIL: MTB list page failed');
    console.log('   Got:', test1);
    testsFailed++;
  }

  // Test 2: Click East Rim Trail from list
  console.log('\n=== Test 2: Click East Rim Trail from list ===');
  const eastRimClicked = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.results-tile'));
    const eastRimTile = tiles.find(tile =>
      tile.textContent.includes('East Rim')
    );
    if (eastRimTile) {
      eastRimTile.click();
      return true;
    }
    return false;
  });

  if (eastRimClicked) {
    await page.waitForTimeout(2000);

    const test2 = await page.evaluate(() => {
      return {
        pathname: window.location.pathname,
        sidebarVisible: !!document.querySelector('.sidebar'),
        title: document.title
      };
    });

    if (test2.pathname === '/east-rim-trail' &&
        test2.sidebarVisible &&
        test2.title.includes('East Rim')) {
      console.log('✅ PASS: Clicking trail navigates to /east-rim-trail');
      testsPassed++;
    } else {
      console.log('❌ FAIL: Trail navigation failed');
      console.log('   Expected: /east-rim-trail');
      console.log('   Got:', test2.pathname);
      testsFailed++;
    }
  } else {
    console.log('⚠️  SKIP: East Rim Trail not found in list');
  }

  // Test 3: Browser back button to MTB list
  console.log('\n=== Test 3: Browser back button to MTB list ===');
  await page.goBack();
  await page.waitForTimeout(1500);

  const test3 = await page.evaluate(() => {
    const resultsTab = document.querySelector('.tab-btn.active')?.textContent;
    return {
      pathname: window.location.pathname,
      activeTab: resultsTab,
      sidebarVisible: !!document.querySelector('.sidebar')
    };
  });

  if (test3.pathname === '/mtb-trail-status' &&
      test3.activeTab === 'Results' &&
      !test3.sidebarVisible) {
    console.log('✅ PASS: Back button returns to /mtb-trail-status');
    testsPassed++;
  } else {
    console.log('❌ FAIL: Back button navigation failed');
    console.log('   Expected: /mtb-trail-status with Results tab');
    console.log('   Got:', test3);
    testsFailed++;
  }

  // Test 4: Browser forward button back to trail
  console.log('\n=== Test 4: Browser forward button back to trail ===');
  await page.goForward();
  await page.waitForTimeout(1500);

  const test4 = await page.evaluate(() => {
    return {
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar'),
      title: document.title
    };
  });

  if (test4.pathname === '/east-rim-trail' &&
      test4.sidebarVisible &&
      test4.title.includes('East Rim')) {
    console.log('✅ PASS: Forward button returns to /east-rim-trail');
    testsPassed++;
  } else {
    console.log('❌ FAIL: Forward button navigation failed');
    console.log('   Got:', test4);
    testsFailed++;
  }

  // Test 5: Multiple back/forward cycles
  console.log('\n=== Test 5: Multiple back/forward cycles ===');
  let cyclesPassed = 0;
  for (let i = 0; i < 3; i++) {
    await page.goBack();
    await page.waitForTimeout(500);
    const backResult = await page.evaluate(() => window.location.pathname);

    await page.goForward();
    await page.waitForTimeout(500);
    const forwardResult = await page.evaluate(() => window.location.pathname);

    if (backResult === '/mtb-trail-status' && forwardResult === '/east-rim-trail') {
      cyclesPassed++;
    }
  }

  if (cyclesPassed === 3) {
    console.log('✅ PASS: Multiple back/forward cycles work correctly');
    testsPassed++;
  } else {
    console.log('❌ FAIL: Back/forward cycles failed');
    console.log('   Passed:', cyclesPassed, '/ 3');
    testsFailed++;
  }

  // Test 6: "Back to MTB Trails" button
  console.log('\n=== Test 6: Back to MTB Trails button ===');
  // Make sure we're on a trail page
  await page.goto('http://localhost:8080/east-rim-trail', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const backButtonClicked = await page.evaluate(() => {
    const backBtn = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent.includes('Back to MTB Trails'));
    if (backBtn) {
      backBtn.click();
      return true;
    }
    return false;
  });

  if (backButtonClicked) {
    await page.waitForTimeout(1500);

    const test6 = await page.evaluate(() => {
      const resultsTab = document.querySelector('.tab-btn.active')?.textContent;
      return {
        pathname: window.location.pathname,
        activeTab: resultsTab
      };
    });

    if (test6.pathname === '/mtb-trail-status' && test6.activeTab === 'Results') {
      console.log('✅ PASS: Back to MTB Trails button works');
      testsPassed++;
    } else {
      console.log('❌ FAIL: Back to MTB Trails button failed');
      console.log('   Got:', test6);
      testsFailed++;
    }
  } else {
    console.log('⚠️  SKIP: Back to MTB Trails button not found');
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('\n✅ MTB trail URLs working correctly:');
    console.log('   - MTB list: /mtb-trail-status');
    console.log('   - Trail detail: /east-rim-trail');
    console.log('   - Browser back/forward: ✓');
    console.log('   - Back to MTB Trails button: ✓');
  } else {
    console.log('\n⚠️  SOME TESTS FAILED');
  }

  await browser.close();
})();
