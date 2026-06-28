// automate.js — live stats display for the be quiet! IOCenter media dock
// Usage: node automate.js
// First run: manually approve the HID device in the browser when prompted.
// Subsequent runs: fully automatic (permission saved in .chromium-profile/).

const { chromium } = require('playwright');
const { generateImage } = require('./generate');

const USER_DATA_DIR = `${__dirname}/.chromium-profile`;
const SITE_URL      = 'https://iocenter.bequiet.com/';
const INTERVAL_MS   = 20_000;

// ─── Browser automation steps ────────────────────────────────────────────────

async function minimizeWindow(page) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    await session.detach();
  } catch {
    // non-fatal
  }
}

async function dismissWelcomePopup(page) {
  try {
    const btn = page.getByRole('button', { name: /got it/i });
    await btn.waitFor({ timeout: 6000 });
    await btn.click();
    console.log('Dismissed welcome popup.');
  } catch {
    // already dismissed or never appeared
  }
}

async function ensureDeviceConnected(page) {
  const noDevice = page.locator('text=No Device detected');

  const alreadyConnected = await noDevice.waitFor({ timeout: 1000 })
    .then(() => false)
    .catch(() => true);

  if (alreadyConnected) {
    console.log('Device already connected (saved authorization).');
    return;
  }

  console.log('\nNo device detected.');
  console.log('>>> Click "Find Device" in the browser, select your keyboard, then click Connect.');
  console.log('Waiting up to 3 minutes...\n');

  await page.getByRole('button', { name: /find device/i }).click();
  await noDevice.waitFor({ state: 'hidden', timeout: 180_000 });
  console.log('Device connected!');
}

async function navigateToMediaDock(page) {
  console.log('Navigating to Media Dock...');
  await page.locator('[data-testid="keyboard-button"]').hover();

  const mediaDock = page
    .getByRole('button', { name: /media dock/i })
    .or(page.getByRole('link', { name: /media dock/i }))
    .or(page.locator(':text-matches("media dock", "i")'))
    .first();

  await mediaDock.waitFor({ state: 'visible', timeout: 5000 });
  await mediaDock.click();
  console.log('On Media Dock.');
}

async function openImagePanel(page) {
  const imageSlot = page.locator('[class*="image-button"]').first();
  await imageSlot.waitFor({ state: 'visible', timeout: 10_000 });
  await imageSlot.click();
  await page.locator('[class*="image-list__item-add"]').waitFor({ state: 'visible', timeout: 8_000 });
}

async function debugButtons(page) {
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((b, i) => ({
      i,
      text: b.textContent.trim().slice(0, 40),
      label: b.getAttribute('aria-label') || '',
      cls: b.className.slice(0, 80),
    })).filter(b => b.text || b.label)
  );
  console.log('\n--- Visible buttons ---');
  buttons.forEach(b => console.log(b.i, JSON.stringify(b.text), JSON.stringify(b.label), b.cls));
  console.log('--- End buttons ---\n');
  await page.screenshot({ path: 'debug-screenshot.png' });
  console.log('Screenshot saved to debug-screenshot.png');
}

async function cleanupOldImages(page) {
  const style = await page.addStyleTag({
    content: '[data-testid="remove-image-button"] { opacity: 1 !important; pointer-events: all !important; }',
  });

  while (true) {
    const result = await page.evaluate(() => {
      const btns = document.querySelectorAll('[data-testid="remove-image-button"]');
      if (btns.length <= 1) return { done: true, count: btns.length };

      const btn = btns[0];

      // Call the React onClick handler directly via the fiber tree
      const fiberKey = Object.keys(btn).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      if (fiberKey) {
        let fiber = btn[fiberKey];
        while (fiber) {
          if (fiber.memoizedProps?.onClick) {
            fiber.memoizedProps.onClick({
              stopPropagation: () => {},
              preventDefault: () => {},
              nativeEvent: { stopImmediatePropagation: () => {} },
            });
            return { done: false, count: btns.length, method: 'react-fiber' };
          }
          fiber = fiber.return;
          if (fiber?.tag === 3) break; // reached HostRoot, stop
        }
      }

      // Fallback: native DOM click
      btn.click();
      return { done: false, count: btns.length, method: 'native-click' };
    });

    if (result.done) break;
    await page.waitForTimeout(500);
  }

  await style.evaluate(el => el.remove());
}

async function uploadImage(page, imagePath) {
  const candidates = [
    page.locator('[class*="image-list__item-add"]'),
    page.getByRole('button', { name: '+' }),
    page.locator('[class*="image-list"] button:has-text("+")'),
    page.locator('[class*="add-image"], [class*="image-add"]'),
  ];

  let addBtn = null;
  for (const candidate of candidates) {
    if (await candidate.first().isVisible().catch(() => false)) {
      addBtn = candidate.first();
      break;
    }
  }

  if (!addBtn) {
    await debugButtons(page);
    throw new Error('Could not find the + button. Check debug-screenshot.png.');
  }

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    addBtn.click(),
  ]);
  await fileChooser.setFiles(imagePath);
  await page.waitForTimeout(800);

  // Select the newly added image (last in list)
  const items = page.locator('[class*="image-list"] [class*="item"]');
  await items.last().click();

  // Clean up old images while the panel is still open
  await cleanupOldImages(page);

  const applyBtn = page.getByRole('button', { name: /apply/i });
  await applyBtn.waitFor({ timeout: 10_000 });
  await applyBtn.click();
  await page.waitForTimeout(1000);
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  console.log('Launching browser...');
  console.log('  Remote DevTools: http://localhost:9222');
  console.log(`  Updating every ${INTERVAL_MS / 1000}s  |  Ctrl+C to stop\n`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: ['--remote-debugging-port=9222'],
    viewport: { width: 1400, height: 900 },
  });

  // Reuse the blank tab Playwright opens rather than creating a second one
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  try {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await dismissWelcomePopup(page);
    await ensureDeviceConnected(page);
    await minimizeWindow(page);
    await navigateToMediaDock(page);

    let iteration = 0;
    while (true) {
      const t0 = Date.now();
      iteration++;

      try {
        const imagePath = await generateImage();
        await openImagePanel(page);
        await uploadImage(page, imagePath);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`  → uploaded in ${elapsed}s (iteration ${iteration})`);
      } catch (err) {
        console.error(`  ✗ iteration ${iteration} failed: ${err.message}`);
        // Don't exit the loop — try again next cycle
      }

      const elapsed = Date.now() - t0;
      const wait = Math.max(0, INTERVAL_MS - elapsed);
      if (wait > 0) await page.waitForTimeout(wait);
    }
  } catch (err) {
    console.error('\nFatal error:', err.message);
    console.log('Browser staying open for inspection. Ctrl+C to exit.');
    await new Promise(() => {});
  }
}

main();
