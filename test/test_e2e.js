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
  // Static / server-rendered
  { name: 'Hacker News',     url: 'https://news.ycombinator.com/' },
  { name: 'MDN Docs',        url: 'https://developer.mozilla.org/en-US/' },
  { name: 'GitHub',          url: 'https://github.com/' },

  // Marketing pages (SSR React / Next)
  { name: 'Stripe',          url: 'https://stripe.com/' },
  { name: 'Linear',          url: 'https://linear.app/' },
  { name: 'Vercel',          url: 'https://vercel.com/' },
  { name: 'Discord',         url: 'https://discord.com/' },
  { name: 'Notion',          url: 'https://www.notion.com/' },

  // Tailwind-native
  { name: 'Tailwind CSS',    url: 'https://tailwindcss.com/' },
  { name: 'shadcn/ui',       url: 'https://ui.shadcn.com/' },

  // Heavy SPA / shadow-DOM-heavy
  { name: 'Spotify',         url: 'https://open.spotify.com/' },
  { name: 'YouTube',         url: 'https://www.youtube.com/' }
];

// Extension source lives in the parent directory (test/ → ../)
const DETECTOR_SRC = fs.readFileSync(path.join(__dirname, '..', 'detector.js'), 'utf8');
const CONTENT_SRC  = fs.readFileSync(path.join(__dirname, '..', 'content.js'),  'utf8');

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
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Heavier SPAs (Spotify, YouTube) need longer to hydrate custom elements
    const hydrationMs = /spotify|youtube|notion/i.test(site.url) ? 6000 : 2500;
    await page.waitForTimeout(hydrationMs);
  } catch (e) {
    navOk = false;
    console.log(`  nav failed: ${e.message}`);
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
    const frozenClones = []; // for post-hoc quality metrics (palette hit, arbitrary rate)
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
        frozenClones.push(frozen.clone);
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

    // Quality metrics: palette-hit rate + named-class rate across every
    // data-tw emitted during the freeze. data-tw lives on the CLONE subtree,
    // not the live DOM, so we walk the saved clones in `frozenClones` below.
    let colorEmits = 0, colorArbitrary = 0;
    let totalClasses = 0, arbitraryClasses = 0;
    let gradientIdiomatic = 0, gradientArbitrary = 0;

    for (const clone of frozenClones) {
      // Include root element itself
      const allEls = [clone, ...clone.querySelectorAll('[data-tw]')];
      for (const el of allEls) {
        const tw = el.getAttribute && el.getAttribute('data-tw');
        if (!tw) continue;
        for (const c of tw.split(/\s+/)) {
          if (!c) continue;
          totalClasses++;
          const isArbitrary = c.includes('[');
          if (isArbitrary) arbitraryClasses++;
          if (/^(bg|text|border|from|via|to|ring|fill|stroke|decoration|outline|accent|caret|divide|placeholder)-/.test(c)) {
            colorEmits++;
            if (isArbitrary) colorArbitrary++;
          }
          if (/^bg-(gradient|linear)-to-/.test(c)) gradientIdiomatic++;
          if (/^bg-\[linear-gradient/.test(c)) gradientArbitrary++;
        }
      }
    }

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
      totalElements: elements.length,
      colorEmits,
      colorArbitrary,
      totalClasses,
      arbitraryClasses,
      gradientIdiomatic,
      gradientArbitrary
    };
  });

  await ctx.close();
  return report;
}

function pct(n, total) {
  if (!total) return ' — ';
  return `${Math.round((n / total) * 100)}%`;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const summary = [];

  for (const site of SITES) {
    process.stdout.write(`\n▸ ${site.name.padEnd(14)} ${site.url}\n`);
    const r = await runSite(browser, site);
    if (!r) { console.log('   (skipped — nav failed)'); summary.push({ name: site.name, skipped: true }); continue; }
    if (r.error) { console.log(`   error: ${r.error}`); summary.push({ name: site.name, skipped: true }); continue; }

    // Condensed per-site: one line of stats + one sample per type
    const groupStr = Object.entries(r.groupCounts).map(([t, c]) => `${t}:${c}`).join(' ');
    console.log(`  scan:${r.scanMs}ms freeze:${r.freezeMs}ms  elements:${r.totalElements}  shadows:${r.shadowHostCount}`);
    console.log(`  candidates:${r.candidateCount}  frozen:${r.freezeSuccessCount}  empty:${r.emptyCaptures}  groups: ${groupStr}`);
    console.log(`  palette hit: ${r.colorEmits - r.colorArbitrary}/${r.colorEmits} (${pct(r.colorEmits - r.colorArbitrary, r.colorEmits)})  ` +
      `gradients: ${r.gradientIdiomatic} idiomatic / ${r.gradientArbitrary} arbitrary  ` +
      `named classes: ${r.totalClasses - r.arbitraryClasses}/${r.totalClasses} (${pct(r.totalClasses - r.arbitraryClasses, r.totalClasses)})`);

    // One sample per type — tightened to first 100 chars of data-tw
    const seenTypes = new Set();
    for (const res of r.results) {
      if (seenTypes.has(res.type)) continue;
      seenTypes.add(res.type);
      const meta = `${res.descendants}des ${res.textLen}txt${res.hasExtraCss ? ` +${(res.extraCssLen / 1024).toFixed(1)}KB css` : ''}`;
      console.log(`    [${res.type.padEnd(7)}] <${res.tag.toLowerCase().padEnd(6)}> ${meta}`);
      if (res.rootTwSample) console.log(`        tw: ${res.rootTwSample.slice(0, 110)}${res.rootTwSample.length > 110 ? '…' : ''}`);
    }

    if (r.emptyCaptures > 0) {
      const reasons = {};
      for (const e of r.empties) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
      const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${v}× ${k}`).join(', ');
      console.log(`    rejected: ${top}`);
    }

    summary.push({
      name: site.name,
      elements: r.totalElements,
      shadows: r.shadowHostCount,
      candidates: r.candidateCount,
      frozen: r.freezeSuccessCount,
      paletteHit: r.colorEmits ? Math.round(((r.colorEmits - r.colorArbitrary) / r.colorEmits) * 100) : null,
      classesNamed: r.totalClasses ? Math.round(((r.totalClasses - r.arbitraryClasses) / r.totalClasses) * 100) : null,
      scanMs: r.scanMs,
      freezeMs: r.freezeMs
    });
  }
  await browser.close();

  // Summary table — makes the whole run grokkable at a glance
  console.log('\n\n===== Summary =====');
  console.log('Site             Elems  Shadow  Cand  Frozen  Palette-hit  Named-cls  Scan   Freeze');
  console.log('─────────────────────────────────────────────────────────────────────────────────────');
  for (const s of summary) {
    if (s.skipped) {
      console.log(`${s.name.padEnd(16)} (skipped)`);
      continue;
    }
    console.log(
      `${s.name.padEnd(16)}` +
      `${String(s.elements).padStart(5)}  ` +
      `${String(s.shadows).padStart(6)}  ` +
      `${String(s.candidates).padStart(4)}  ` +
      `${String(s.frozen).padStart(6)}  ` +
      `${(s.paletteHit !== null ? s.paletteHit + '%' : ' — ').padStart(10)}  ` +
      `${(s.classesNamed !== null ? s.classesNamed + '%' : ' — ').padStart(9)}  ` +
      `${String(s.scanMs).padStart(4)}ms  ` +
      `${String(s.freezeMs).padStart(5)}ms`
    );
  }
  console.log('');
})().catch(e => { console.error(e); process.exit(1); });
