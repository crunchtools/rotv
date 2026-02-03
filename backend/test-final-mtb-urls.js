import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  console.log('==============================================');
  console.log('MTB Trail URL Structure - Final Verification');
  console.log('==============================================\n');

  // Requirement 1: MTB list at /mtb-trail-status
  console.log('✓ Requirement 1: MTB list should be at http://localhost:8080/mtb-trail-status');
  await page.goto('http://localhost:8080/mtb-trail-status', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(2000);

  const req1 = await page.evaluate(() => ({
    pathname: window.location.pathname,
    hasTiles: document.querySelectorAll('.results-tile').length > 0
  }));

  console.log(`  URL: ${req1.pathname}`);
  console.log(`  Has trail tiles: ${req1.hasTiles}`);
  console.log(`  ${req1.pathname === '/mtb-trail-status' && req1.hasTiles ? '✅ PASS' : '❌ FAIL'}\n`);

  // Requirement 2: Clicking East Rim goes to /east-rim-trail
  console.log('✓ Requirement 2: When East Rim is clicked, should jump to http://localhost:8080/east-rim-trail');
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

    const req2 = await page.evaluate(() => ({
      pathname: window.location.pathname,
      sidebarVisible: !!document.querySelector('.sidebar')
    }));

    console.log(`  Clicked: ${clicked}`);
    console.log(`  URL: ${req2.pathname}`);
    console.log(`  Sidebar visible: ${req2.sidebarVisible}`);
    console.log(`  ${req2.pathname === '/east-rim-trail' && req2.sidebarVisible ? '✅ PASS' : '❌ FAIL'}\n`);
  } else {
    console.log('  ❌ FAIL: Could not find East Rim tile\n');
  }

  // Requirement 3: Back button returns to /mtb-trail-status
  console.log('✓ Requirement 3: Using browser back button should jump to http://localhost:8080/mtb-trail-status');
  await page.goBack();
  await page.waitForTimeout(1500);

  const req3 = await page.evaluate(() => ({
    pathname: window.location.pathname,
    activeTab: document.querySelector('.tab-btn.active')?.textContent
  }));

  console.log(`  URL: ${req3.pathname}`);
  console.log(`  Active tab: ${req3.activeTab}`);
  console.log(`  ${req3.pathname === '/mtb-trail-status' && req3.activeTab === 'Results' ? '✅ PASS' : '❌ FAIL'}\n`);

  // Requirement 4: Forward button returns to /east-rim-trail
  console.log('✓ Requirement 4: Using browser forward button should jump back to http://localhost:8080/east-rim-trail');
  await page.goForward();
  await page.waitForTimeout(1500);

  const req4 = await page.evaluate(() => ({
    pathname: window.location.pathname,
    sidebarVisible: !!document.querySelector('.sidebar')
  }));

  console.log(`  URL: ${req4.pathname}`);
  console.log(`  Sidebar visible: ${req4.sidebarVisible}`);
  console.log(`  ${req4.pathname === '/east-rim-trail' && req4.sidebarVisible ? '✅ PASS' : '❌ FAIL'}\n`);

  // Requirement 5: Back/forward can be used many times
  console.log('✓ Requirement 5: User should be able to hit browser forward or back button as many times as they like');
  let cyclesSucceeded = 0;
  const totalCycles = 5;

  for (let i = 0; i < totalCycles; i++) {
    await page.goBack();
    await page.waitForTimeout(300);
    const backUrl = await page.evaluate(() => window.location.pathname);

    await page.goForward();
    await page.waitForTimeout(300);
    const forwardUrl = await page.evaluate(() => window.location.pathname);

    if (backUrl === '/mtb-trail-status' && forwardUrl === '/east-rim-trail') {
      cyclesSucceeded++;
    }
  }

  console.log(`  Cycles tested: ${totalCycles}`);
  console.log(`  Cycles succeeded: ${cyclesSucceeded}`);
  console.log(`  ${cyclesSucceeded === totalCycles ? '✅ PASS' : '❌ FAIL'}\n`);

  // Requirement 6: "Back to MTB Trails" button works
  console.log('✓ Requirement 6: "Back to MTB Trails" button should navigate to /mtb-trail-status');
  // Navigate from list to ensure button appears
  await page.goto('http://localhost:8080/mtb-trail-status', {
    waitUntil: 'networkidle',
    timeout: 30000
  });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.results-tile'));
    const eastRimTile = tiles.find(tile => tile.textContent.includes('East Rim'));
    if (eastRimTile) eastRimTile.click();
  });

  await page.waitForTimeout(2000);

  const backButtonClicked = await page.evaluate(() => {
    const backButton = Array.from(document.querySelectorAll('button'))
      .find(btn => btn.textContent.includes('Back to MTB Trails'));
    if (backButton) {
      backButton.click();
      return true;
    }
    return false;
  });

  if (backButtonClicked) {
    await page.waitForTimeout(1500);

    const req6 = await page.evaluate(() => ({
      pathname: window.location.pathname,
      activeTab: document.querySelector('.tab-btn.active')?.textContent
    }));

    console.log(`  Button found: ${backButtonClicked}`);
    console.log(`  URL: ${req6.pathname}`);
    console.log(`  Active tab: ${req6.activeTab}`);
    console.log(`  ${req6.pathname === '/mtb-trail-status' && req6.activeTab === 'Results' ? '✅ PASS' : '❌ FAIL'}\n`);
  } else {
    console.log('  ❌ FAIL: Back button not found\n');
  }

  console.log('==============================================');
  console.log('All requirements verified!');
  console.log('==============================================');

  await browser.close();
})();
