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

  console.log('Clicking East Rim Trail from list...');
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

    const state = await page.evaluate(() => {
      const backButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.includes('Back to MTB Trails'));

      return {
        pathname: window.location.pathname,
        sidebarVisible: !!document.querySelector('.sidebar'),
        hasBackButton: !!backButton,
        backButtonText: backButton?.textContent
      };
    });

    console.log('\nAfter clicking trail from MTB list:');
    console.log('  URL:', state.pathname);
    console.log('  Sidebar visible:', state.sidebarVisible);
    console.log('  Has "Back to MTB Trails" button:', state.hasBackButton);
    console.log('  Button text:', state.backButtonText);

    if (state.hasBackButton) {
      console.log('\n✅ Back to MTB Trails button is visible!');

      // Click the button
      const clicked = await page.evaluate(() => {
        const backButton = Array.from(document.querySelectorAll('button'))
          .find(btn => btn.textContent.includes('Back to MTB Trails'));
        if (backButton) {
          backButton.click();
          return true;
        }
        return false;
      });

      if (clicked) {
        await page.waitForTimeout(1500);

        const afterClick = await page.evaluate(() => {
          return {
            pathname: window.location.pathname,
            activeTab: document.querySelector('.tab-btn.active')?.textContent
          };
        });

        console.log('\nAfter clicking "Back to MTB Trails":');
        console.log('  URL:', afterClick.pathname);
        console.log('  Active tab:', afterClick.activeTab);

        if (afterClick.pathname === '/mtb-trail-status' && afterClick.activeTab === 'Results') {
          console.log('\n✅ SUCCESS: Back button navigates to /mtb-trail-status');
        } else {
          console.log('\n❌ FAILED: Back button navigation incorrect');
        }
      }
    } else {
      console.log('\n❌ Back to MTB Trails button not found!');
      console.log('This button should be visible when navigating from the MTB list.');
    }
  } else {
    console.log('❌ East Rim Trail not found in list');
  }

  await browser.close();
})();
