// Full-extension E2E test. Launches Chrome with EasyDiv loaded as an
// unpacked extension, then exercises the real message flow end-to-end:
//   - content scripts auto-inject on page load
//   - service worker bridges popup↔content
//   - scrapePage fills chrome.storage.local.dockItems
//   - popup.html loads without errors
//   - JSX emitter converts dock HTML correctly
//
// This is the closest thing to a user hitting "Scrape Page" — it goes through
// the actual Chrome extension runtime, not the engine in isolation.
//
//   node test/test_extension.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Tests live under test/; the extension root is the parent directory.
const EXT_PATH = path.join(__dirname, '..');
const USER_DATA_DIR = `/tmp/easydiv-e2e-${Date.now()}`;
const TARGET_URL = 'https://stripe.com/';

function ok(label, cond, detail = '') {
  const mark = cond ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? `  — ${detail}` : ''}`);
  return cond;
}

(async () => {
  console.log('→ Launching Chromium with EasyDiv loaded');
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // extensions don't work in headless mode
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  let passed = 0, failed = 0;
  const track = (cond) => (cond ? passed++ : failed++);

  try {
    // Wait for service worker (background.js) to register
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];
    track(ok('extension service worker registered', true, `id=${extId}`));

    // ---------- Content scripts auto-inject on target site ----------
    console.log(`\n→ Loading target: ${TARGET_URL}`);
    const page = await ctx.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500); // SPA hydration

    // Content scripts run in an isolated world — page.evaluate() runs in the
    // PAGE world and can't see `window.__easyDivDetector`. We probe the
    // isolated world via chrome.scripting.executeScript from the service worker.
    const tabIdForProbe = await sw.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return (tabs.find(t => t.url && t.url.startsWith(url)) || {}).id;
    }, TARGET_URL);

    const loaded = await sw.evaluate(async (tid) => {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tid },
        world: 'ISOLATED',
        func: () => ({
          detector: typeof window.__easyDivDetector !== 'undefined',
          engine: typeof window.__easyDivEngine !== 'undefined',
          detectorType: typeof window.__easyDivDetector?.scanPage
        })
      });
      return res.result;
    }, tabIdForProbe);
    track(ok('detector.js injected in isolated world', loaded.detector));
    track(ok('content.js injected in isolated world', loaded.engine));
    track(ok('scanPage is callable', loaded.detectorType === 'function'));

    // ---------- Run scrapePage end-to-end ----------
    console.log('\n→ Running scrapePage via message flow');
    const tabId = await sw.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const match = tabs.find(t => t.url && t.url.startsWith(url));
      return match ? match.id : null;
    }, TARGET_URL);
    track(ok('target tab discoverable from SW', tabId !== null, `tabId=${tabId}`));

    const scrapeRes = await sw.evaluate(async (tid) => {
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(tid, { action: 'scrapePage' }, (r) => {
          resolve(r || { error: chrome.runtime.lastError?.message });
        });
      });
    }, tabId);
    track(ok('scrapePage responded',
      scrapeRes && scrapeRes.success,
      JSON.stringify({
        scanned: scrapeRes?.scanned,
        captured: scrapeRes?.captured,
        groups: scrapeRes?.groupCounts
      })));

    // Read dock items from storage
    const dock = await sw.evaluate(() => new Promise((r) =>
      chrome.storage.local.get({ dockItems: [] }, (s) => r(s.dockItems))
    ));
    track(ok('dockItems persisted to storage', dock.length > 0, `${dock.length} items`));
    track(ok('at least one captured header', dock.some(d => d.category === 'header')));
    track(ok('at least one captured button', dock.some(d => d.category === 'button')));

    // Verify the dock items have `data-tw` attributes with the new palette classes
    const sampleHtml = dock[0]?.html || '';
    const hasDataTw = /data-tw="/.test(sampleHtml);
    track(ok('captured HTML has data-tw attr', hasDataTw));
    // Expect some palette-matched classes on Stripe (bg-white or text-black at a minimum)
    const hasPaletteMatch = dock.some(d => /\b(text-black|bg-white|text-white|bg-black)\b/.test(d.html || ''));
    track(ok('palette matcher hit (text-black/bg-white/etc)', hasPaletteMatch));

    // ---------- popup.html loads correctly ----------
    console.log('\n→ Opening popup.html');
    const popupPage = await ctx.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await popupPage.waitForTimeout(1500);

    const popupHealth = await popupPage.evaluate(() => {
      const btns = ['toggle-inspector', 'scrape-page', 'preview-design', 'copy-full-page', 'clear-dock'];
      return {
        buttons: btns.map(id => ({ id, present: !!document.getElementById(id) })),
        dockListExists: !!document.getElementById('dock-list'),
        dockChildCount: document.getElementById('dock-list')?.children.length ?? 0,
        hasCategoryFilter: !!document.getElementById('category-filter')
      };
    });
    for (const b of popupHealth.buttons) track(ok(`popup has #${b.id}`, b.present));
    track(ok('popup rendered dock items', popupHealth.dockChildCount > 0, `${popupHealth.dockChildCount} rows`));

    // ---------- Copy dropdown — open menu, click JSX, verify clipboard ----------
    console.log('\n→ Testing copy dropdown + JSX conversion');
    const menuTriggers = await popupPage.$$('.btn-copy-menu');
    track(ok('Copy dropdown trigger rendered per dock item', menuTriggers.length > 0, `${menuTriggers.length} menus`));

    const jsxSample = await popupPage.evaluate(() => {
      return new Promise((resolve) => {
        const menu = document.querySelector('.copy-menu');
        if (!menu) return resolve(null);
        // Open the first menu
        menu.querySelector('.btn-copy-menu').click();
        // Then click its JSX option
        const jsxBtn = menu.querySelector('.copy-menu-panel button[data-mode="jsx"]');
        if (!jsxBtn) return resolve({ error: 'no JSX option in panel' });
        jsxBtn.click();
        // The handler has a 10ms setTimeout; give it a moment, then read clipboard
        setTimeout(async () => {
          try {
            const text = await navigator.clipboard.readText();
            resolve(text);
          } catch (e) {
            resolve({ error: e.message });
          }
        }, 200);
      });
    });
    if (typeof jsxSample === 'string' && jsxSample.length > 0) {
      track(ok('JSX button produced clipboard text', true, `${jsxSample.length} chars`));
      track(ok('JSX uses className not class', !/\s+class="/.test(jsxSample) || /className=/.test(jsxSample)));
      const looksLikeJsx = /<[a-z]+[^>]*\/>/.test(jsxSample) || /className=/.test(jsxSample);
      track(ok('JSX output looks like JSX', looksLikeJsx));
      // Save to a file for manual inspection
      fs.writeFileSync('/tmp/easydiv-jsx-sample.txt', jsxSample);
      console.log('   (JSX sample saved to /tmp/easydiv-jsx-sample.txt)');
    } else {
      track(ok('JSX clipboard read', false, jsxSample?.error || 'no text'));
    }

    // ---------- Color palette output smoke check ----------
    console.log('\n→ Inspecting root data-tw for palette matches');
    const firstItemTw = dock[0]?.html?.match(/data-tw="([^"]*)"/)?.[1] || '';
    console.log(`   [${dock[0]?.category}] data-tw: ${firstItemTw.slice(0, 200)}`);

    // ---------- Screenshot the popup + inspect preview iframes ----------
    console.log('\n→ Screenshotting popup for visual check');
    await popupPage.setViewportSize({ width: 380, height: 900 });
    await popupPage.waitForTimeout(2000); // let iframes finish writing Tailwind CDN output
    await popupPage.screenshot({ path: '/tmp/easydiv-popup.png', fullPage: true });
    console.log('   popup screenshot: /tmp/easydiv-popup.png');

    // Pull the rendered body html from the first preview iframe so we can see
    // what's reaching the renderer — the ACTUAL concern is that Tailwind CDN
    // might not be styling our arbitrary-value classes.
    const iframeReport = await popupPage.evaluate(async () => {
      const iframes = document.querySelectorAll('.preview-box iframe');
      const reports = [];
      for (let i = 0; i < Math.min(iframes.length, 3); i++) {
        const f = iframes[i];
        try {
          const doc = f.contentDocument;
          if (!doc) { reports.push({ i, err: 'no contentDocument' }); continue; }
          const root = doc.body?.firstElementChild;
          if (!root) { reports.push({ i, err: 'no body child' }); continue; }
          // Check if Tailwind CDN actually applied styles — a computed style
          // with real pixel values indicates yes; everything auto means no
          const style = doc.defaultView.getComputedStyle(root);
          reports.push({
            i,
            tag: root.tagName,
            className: (root.className || '').toString().slice(0, 80),
            bodyChildCount: doc.body.children.length,
            rootOffsetH: root.offsetHeight,
            rootOffsetW: root.offsetWidth,
            display: style.display,
            width: style.width,
            height: style.height,
            background: style.backgroundColor,
            color: style.color,
            tailwindLoaded: !!doc.querySelector('script[src*="tailwindcss.com"]')
          });
        } catch (e) {
          reports.push({ i, err: e.message });
        }
      }
      return reports;
    });
    console.log('   preview iframe report:');
    for (const r of iframeReport) {
      if (r.err) {
        console.log(`      [${r.i}] ERR: ${r.err}`);
      } else {
        console.log(`      [${r.i}] <${r.tag.toLowerCase()}> ${r.rootOffsetW}x${r.rootOffsetH}  display=${r.display}  bg=${r.background}  color=${r.color}  TWCDN=${r.tailwindLoaded}`);
      }
    }

  } catch (e) {
    console.error('\n💥 Test threw:', e.message);
    failed++;
  } finally {
    await ctx.close();
    try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
