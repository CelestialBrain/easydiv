// End-to-end test harness. Launches a real Chromium, navigates to target
// sites, injects detector.js + the engine internals from content.js, runs the
// full scrape + freeze pipeline, and reports quality metrics.
//
//   node test_e2e.js
//
// Each site report includes:
//   - candidate count / groups
//   - freeze success rate, median output size
//   - empty-capture rate
//   - sample output (first candidate of each type) with clipped HTML + TW

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// The extension expects a chrome extension environment. We can't load content.js
// as-is because it references `chrome.*`. Instead we inject two things:
//   1. detector.js unchanged
//   2. An extracted subset of content.js — only the engine functions, no chrome APIs
//
// The simplest robust approach: just inject the files, but stub `chrome.*` first
// so the module-level code doesn't throw.

const SITES = [
  { name: 'Hacker News',      url: 'https://news.ycombinator.com/' },
  { name: 'Stripe',           url: 'https://stripe.com/' },
  { name: 'Linear',           url: 'https://linear.app/' },
  { name: 'Tailwind Play',    url: 'https://tailwindcss.com/' },
  { name: 'Vercel',           url: 'https://vercel.com/' }
];

const DETECTOR_SRC = fs.readFileSync(path.join(__dirname, 'detector.js'), 'utf8');
const CONTENT_SRC  = fs.readFileSync(path.join(__dirname, 'content.js'),  'utf8');

function clipText(s, n) {
  if (!s) return '';
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function runSite(browser, site) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    bypassCSP: true // needed to inject our scripts on CSP-strict sites (Stripe, etc.)
  });
  const page = await ctx.newPage();

  let navOk = true;
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Give SPAs a moment to hydrate
    await page.waitForTimeout(2500);
  } catch (e) {
    navOk = false;
    console.log(`  ❌ nav failed: ${e.message}`);
  }
  if (!navOk) { await ctx.close(); return null; }

  // Stub chrome.* before injecting content.js so module-level calls don't throw
  await page.addInitScript(() => {
    window.chrome = window.chrome || {
      storage: { local: { get: (_k, cb) => cb({ dockItems: [] }), set: (_v, cb) => cb && cb() } },
      runtime: { onMessage: { addListener: () => { } }, lastError: null }
    };
  });

  // Re-inject after navigation since addInitScript fires on new doc
  await page.evaluate(() => {
    if (!window.chrome) {
      window.chrome = {
        storage: { local: { get: (_k, cb) => cb({ dockItems: [] }), set: (_v, cb) => cb && cb() } },
        runtime: { onMessage: { addListener: () => { } }, lastError: null }
      };
    }
  });

  await page.addScriptTag({ content: DETECTOR_SRC });
  await page.addScriptTag({ content: CONTENT_SRC });

  const report = await page.evaluate(() => {
    const det = window.__easyDivDetector;
    const eng = window.__easyDivEngine;
    if (!det || !eng) return { error: 'engine not loaded' };

    const t0 = performance.now();
    const { candidates, groups } = det.scanPage(document);
    const scanMs = performance.now() - t0;

    const groupCounts = {};
    for (const [type, list] of Object.entries(groups)) groupCounts[type] = list.length;

    // Build rule cache once
    const ruleCache = eng.buildRuleCache();

    const results = [];
    const empties = [];
    const freezeStart = performance.now();
    const MAX_DESCENDANTS = 600;
    for (const c of candidates) {
      try {
        // Match scrapePage's pre-freeze cap — avoid whole-page captures
        const liveDesc = c.el.getElementsByTagName ? c.el.getElementsByTagName('*').length : 0;
        if (liveDesc > MAX_DESCENDANTS) {
          empties.push({ type: c.type, reason: `too-large:${liveDesc}` });
          continue;
        }

        const frozen = eng.freezeElement(c.el, ruleCache);
        if (!frozen) { empties.push({ type: c.type, reason: 'freeze-null' }); continue; }
        const html = frozen.clone.outerHTML;
        const textLen = (frozen.clone.textContent || '').trim().length;
        const mediaCount = frozen.clone.querySelectorAll('img, svg, video, canvas, picture').length;
        const descendants = frozen.clone.querySelectorAll('*').length;
        const isEmpty = textLen === 0 && mediaCount === 0 && descendants < 2;
        const rootTw = frozen.clone.getAttribute('data-tw') || '';
        const rootInline = frozen.clone.getAttribute('data-inline-style') || '';
        results.push({
          type: c.type,
          score: c.score,
          reason: c.reason,
          tag: c.el.tagName,
          size: html.length,
          textLen,
          mediaCount,
          descendants,
          isEmpty,
          hasExtraCss: (frozen.extraCss || '').length > 0,
          extraCssLen: (frozen.extraCss || '').length,
          rootTwLen: rootTw.length,
          rootTwSample: rootTw.slice(0, 120),
          rootInlineLen: rootInline.length,
          rootInlineSample: rootInline.slice(0, 120),
          snippet: html.slice(0, 180)
        });
      } catch (e) {
        empties.push({ type: c.type, reason: `freeze-threw: ${e.message}` });
      }
    }
    const freezeMs = performance.now() - freezeStart;

    // Shadow DOM probe
    const elements = document.querySelectorAll('*');
    let shadowHostCount = 0;
    for (const el of elements) if (el.shadowRoot) shadowHostCount++;

    return {
      scanMs: Math.round(scanMs),
      freezeMs: Math.round(freezeMs),
      candidateCount: candidates.length,
      groupCounts,
      freezeSuccessCount: results.length,
      emptyCaptures: empties.length,
      results,
      empties,
      shadowHostCount,
      totalElements: elements.length
    };
  });

  await ctx.close();
  return report;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const site of SITES) {
    console.log(`\n▸ ${site.name}  (${site.url})`);
    const r = await runSite(browser, site);
    if (!r) { console.log('   skipped'); continue; }
    if (r.error) { console.log(`  ❌ ${r.error}`); continue; }

    console.log(`  scan:${r.scanMs}ms freeze:${r.freezeMs}ms  elements:${r.totalElements}  shadow-hosts:${r.shadowHostCount}`);
    console.log(`  candidates:${r.candidateCount}  frozen:${r.freezeSuccessCount}  empty:${r.emptyCaptures}`);
    const groupSummary = Object.entries(r.groupCounts).map(([t, c]) => `${t}:${c}`).join(' ');
    console.log(`  groups: ${groupSummary}`);

    // Size stats
    const sizes = r.results.map(x => x.size);
    const twLens = r.results.map(x => x.rootTwLen);
    const inlineLens = r.results.map(x => x.rootInlineLen);
    console.log(`  html size (bytes)         min=${Math.min(...sizes)} median=${median(sizes)} max=${Math.max(...sizes)}`);
    console.log(`  root data-tw length       min=${Math.min(...twLens)} median=${median(twLens)} max=${Math.max(...twLens)}`);
    console.log(`  root data-inline-style    min=${Math.min(...inlineLens)} median=${median(inlineLens)} max=${Math.max(...inlineLens)}`);

    // One sample per type
    const seenTypes = new Set();
    for (const res of r.results) {
      if (seenTypes.has(res.type)) continue;
      seenTypes.add(res.type);
      console.log(`\n  [${res.type}] score=${res.score}  <${res.tag.toLowerCase()}> ${res.descendants}des ${res.textLen}txt ${res.mediaCount}media${res.hasExtraCss ? ` +${res.extraCssLen}B css` : ''}`);
      console.log(`    snippet: ${clipText(res.snippet, 160)}`);
      if (res.rootTwSample) console.log(`    data-tw: ${res.rootTwSample}`);
      if (res.rootInlineSample) console.log(`    inline:  ${res.rootInlineSample}`);
    }

    if (r.emptyCaptures > 0) {
      const reasons = {};
      for (const e of r.empties) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
      console.log(`\n  Empty breakdown: ${Object.entries(reasons).map(([k, v]) => `${v}× ${k}`).join(', ')}`);
    }
  }
  await browser.close();
  console.log('\nDone.\n');
})().catch(e => { console.error(e); process.exit(1); });
