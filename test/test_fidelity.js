// 1:1 fidelity test. Honest pixel-diff between the ORIGINAL rendering of a
// captured element and our REPRODUCED rendering from the captured HTML.
//
// Protocol (per site):
//   1. Navigate to the target, wait for hydration.
//   2. Inject detector + engine, run scanPage to find candidates.
//   3. For each test target type (button, header, nav, card, section):
//      a. Find the first candidate of that type.
//      b. Scroll it into view, screenshot its clientRect on the real page.
//      c. freezeElement → universal-mode HTML (fully self-contained inline styles).
//      d. Open a fresh blank page, dump the rendered HTML in, wait for fonts,
//         screenshot the equivalent element.
//   4. Crop both screenshots to the same bounding box, compare via pixelmatch.
//   5. Report % pixel match.
//
// Universal mode is the right comparison target — it bakes every computed
// property as inline style, so there's no tailwind/CDN race. Any divergence
// is genuinely about the engine's capture fidelity.
//
//   node test_fidelity.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
// pixelmatch v7 is ESM-only; resolved lazily at first use.
let pixelmatch;
async function getPixelmatch() {
  if (!pixelmatch) pixelmatch = (await import('pixelmatch')).default;
  return pixelmatch;
}

// Extension source lives in the parent directory (test/ → ../)
const DETECTOR_SRC = fs.readFileSync(path.join(__dirname, '..', 'detector.js'), 'utf8');
const CONTENT_SRC  = fs.readFileSync(path.join(__dirname, '..', 'content.js'),  'utf8');

// Small set — fidelity is slow (~30s per site × 5 component types).
const TARGETS = [
  { name: 'Stripe',        url: 'https://stripe.com/',      types: ['header', 'footer', 'button', 'section'] },
  { name: 'Vercel',        url: 'https://vercel.com/',      types: ['header', 'footer', 'button', 'nav'] },
  { name: 'shadcn/ui',     url: 'https://ui.shadcn.com/',   types: ['header', 'footer', 'button', 'nav'] },
  { name: 'Discord',       url: 'https://discord.com/',     types: ['header', 'button'] },
  { name: 'Notion',        url: 'https://www.notion.com/',  types: ['button', 'footer'] }
];

const OUT_DIR = '/tmp/easydiv-fidelity';
try { fs.rmSync(OUT_DIR, { recursive: true, force: true }); } catch {}
fs.mkdirSync(OUT_DIR, { recursive: true });

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

// Keep in sync with content.js PREFLIGHT_CSS — our Universal-mode copies include this.
const PREFLIGHT_CSS = [
  '*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid}',
  'html{line-height:1.5;-webkit-text-size-adjust:100%;tab-size:4}',
  'body{margin:0;line-height:inherit}',
  'hr{height:0;color:inherit;border-top-width:1px}',
  'abbr:where([title]){text-decoration:underline dotted}',
  'h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit;margin:0}',
  'a{color:inherit;text-decoration:inherit}',
  'b,strong{font-weight:bolder}',
  'small{font-size:80%}',
  'table{text-indent:0;border-color:inherit;border-collapse:collapse}',
  'button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;color:inherit;margin:0;padding:0}',
  'button,select{text-transform:none}',
  "button,[type='button'],[type='reset'],[type='submit']{-webkit-appearance:button;background-color:transparent;background-image:none}",
  'summary{display:list-item}',
  'blockquote,dl,dd,figure,pre{margin:0}',
  'fieldset{margin:0;padding:0}',
  'legend{padding:0}',
  'ol,ul,menu{list-style:none;margin:0;padding:0}',
  'textarea{resize:vertical}',
  'button,[role="button"]{cursor:pointer}',
  'img,svg,video,canvas,audio,iframe,embed,object{display:block;vertical-align:middle}',
  'img,video{max-width:100%;height:auto}',
  '[hidden]{display:none}'
].join('');

// Read PNG file → Buffer, parse, return { data, width, height }.
function loadPng(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return png;
}

// Convert captured HTML (which uses data-inline-style) into a standalone
// self-rendering document. Universal-mode transform: promote data-inline-style
// to style, drop data-tw + class markers.
function toUniversalHtml(rawHtml) {
  // This runs in Node so we can't use DOMParser. A simple regex pass is enough
  // for the transforms we need: data-inline-style="..." → style="..."
  // Drop data-tw attributes since they do nothing here.
  return rawHtml
    .replace(/\sdata-inline-style="([^"]*)"/g, ' style="$1"')
    .replace(/\sdata-tw="[^"]*"/g, '')
    .replace(/\sdata-tw='[^']*'/g, '')
    .replace(/\sdata-iframe-[^=]+="[^"]*"/g, '');
}

async function captureAndRender(browser, site) {
  console.log(`\n▸ ${site.name}  ${site.url}`);
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    bypassCSP: true
  });
  const page = await ctx.newPage();
  try {
    await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`  nav failed: ${e.message}`);
    await ctx.close();
    return [];
  }
  await page.waitForTimeout(/spotify|youtube|notion/i.test(site.url) ? 6000 : 3500);
  // Wait for webfonts so the original screenshot includes them
  await page.evaluate(() => document.fonts ? document.fonts.ready : Promise.resolve());

  await page.addInitScript(() => {
    window.chrome = window.chrome || {
      storage: { local: { get: (_k, cb) => cb({ dockItems: [] }), set: (_v, cb) => cb && cb() } },
      runtime: { onMessage: { addListener: () => { } }, lastError: null }
    };
  });
  await page.evaluate(() => {
    if (!window.chrome) window.chrome = {
      storage: { local: { get: (_k, cb) => cb({ dockItems: [] }), set: (_v, cb) => cb && cb() } },
      runtime: { onMessage: { addListener: () => { } }, lastError: null }
    };
  });
  await page.addScriptTag({ content: DETECTOR_SRC });
  await page.addScriptTag({ content: CONTENT_SRC });

  // For each target type, pick the first reasonably-sized candidate and
  // capture both the original screenshot and the engine output.
  const captures = await page.evaluate((types) => {
    const det = window.__easyDivDetector;
    const eng = window.__easyDivEngine;
    if (!det || !eng) return { error: 'engine not loaded' };
    const { candidates } = det.scanPage(document);
    const ruleCache = eng.buildRuleCache();

    const out = [];
    for (const type of types) {
      const c = candidates.find(x => x.type === type && x.el.getBoundingClientRect().width > 60 && x.el.getBoundingClientRect().height > 20);
      if (!c) { out.push({ type, skipped: 'no-candidate' }); continue; }
      c.el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = c.el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || r.width > 1440 || r.height > 3000) {
        out.push({ type, skipped: `size-bounds:${Math.round(r.width)}x${Math.round(r.height)}` });
        continue;
      }
      let frozen = null;
      try { frozen = eng.freezeElement(c.el, ruleCache); } catch (e) {
        out.push({ type, skipped: `freeze-threw:${e.message}` });
        continue;
      }
      if (!frozen) { out.push({ type, skipped: 'freeze-null' }); continue; }

      // Collect fonts on the element so we can load them in the rendered copy
      const cs = window.getComputedStyle(c.el);
      out.push({
        type,
        tag: c.el.tagName.toLowerCase(),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        html: frozen.clone.outerHTML,
        extraCss: frozen.extraCss,
        ancestorContext: frozen.ancestorContext,
        fontFamily: cs.fontFamily,
        rootBg: cs.backgroundColor
      });
    }
    return { items: out, url: window.location.href };
  }, site.types);

  if (captures.error) {
    console.log(`  engine not loaded`);
    await ctx.close();
    return [];
  }

  const results = [];
  for (const cap of captures.items) {
    if (cap.skipped) {
      console.log(`    [${cap.type.padEnd(7)}] skipped: ${cap.skipped}`);
      results.push({ site: site.name, type: cap.type, skipped: cap.skipped });
      continue;
    }
    // After scrolling, the rect needs updating since we took it before scroll.
    // Simplest: scroll + re-screenshot via a fresh element handle and Playwright
    // element screenshot. We need an ElementHandle — easiest path: use
    // querySelector with the captured path, OR just take a fullPage screenshot
    // + crop. For reliability, re-scroll + use element handle via a marker.
    const marker = `easydiv-fid-${Date.now()}`;
    await page.evaluate(({ type, marker }) => {
      const det = window.__easyDivDetector;
      const { candidates } = det.scanPage(document);
      const c = candidates.find(x => x.type === type && x.el.getBoundingClientRect().width > 60 && x.el.getBoundingClientRect().height > 20);
      if (!c) return;
      c.el.setAttribute('data-easydiv-marker', marker);
      c.el.scrollIntoView({ block: 'center', inline: 'center' });
    }, { type: cap.type, marker });
    await page.waitForTimeout(500); // let scroll settle

    const handle = await page.$(`[data-easydiv-marker="${marker}"]`);
    if (!handle) {
      results.push({ site: site.name, type: cap.type, skipped: 'marker-missing' });
      continue;
    }
    const origPath = `${OUT_DIR}/${site.name.replace(/\W+/g, '')}-${cap.type}-orig.png`;
    const repPath  = `${OUT_DIR}/${site.name.replace(/\W+/g, '')}-${cap.type}-reproduced.png`;

    let origBox = null;
    try {
      await handle.screenshot({ path: origPath, animations: 'disabled', omitBackground: false });
      origBox = await handle.boundingBox();
    } catch (e) {
      results.push({ site: site.name, type: cap.type, skipped: `orig-shot:${e.message.slice(0, 40)}` });
      continue;
    }

    // Reproduce in a fresh page. Universal-mode HTML = inline styles only.
    // Include preflight reset (what real Universal-mode copies ship with)
    // before extraCss so captured pseudo/keyframe rules can override defaults.
    // Also wrap in ancestor-context divs so components whose visual depends
    // on a parent background or flex/grid layout reproduce faithfully.
    let innerHtml = toUniversalHtml(cap.html);
    const ac = cap.ancestorContext;
    if (ac) {
      if (ac.parentLayout) {
        const pl = ac.parentLayout;
        const kebab = (k) => k.replace(/([A-Z])/g, '-$1').toLowerCase();
        const decls = Object.entries(pl)
          .filter(([, v]) => v && v !== 'normal' && v !== 'none' && v !== 'auto')
          .map(([k, v]) => `${kebab(k)}: ${v}`)
          .join('; ');
        if (decls) innerHtml = `<div data-ed-parent-layout style="${decls}">${innerHtml}</div>`;
      }
      const outerDecls = [];
      if (ac.pageBg) outerDecls.push(`background: ${ac.pageBg}`);
      if (ac.color) outerDecls.push(`color: ${ac.color}`);
      if (ac.fontFamily) outerDecls.push(`font-family: ${ac.fontFamily}`);
      if (outerDecls.length) innerHtml = `<div data-ed-ancestor-context style="${outerDecls.join('; ')}">${innerHtml}</div>`;
    }
    const combinedCss = [PREFLIGHT_CSS, cap.extraCss || ''].filter(Boolean).join('\n');
    const repDoc = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <style>
        html, body { margin: 0; padding: 0; background: white; }
        body { min-width: 1440px; }
      </style>
      <style>${combinedCss}</style>
    </head><body>${innerHtml}</body></html>`;

    const repPage = await ctx.newPage();
    try {
      // Match the original viewport exactly — stretching it causes block-level
      // elements to reflow to a different width, which skews the diff.
      await repPage.setViewportSize({
        width: 1440,
        height: Math.max(900, Math.ceil(origBox.height + 100))
      });
      await repPage.setContent(repDoc, { waitUntil: 'domcontentloaded' });
      await repPage.evaluate(() => document.fonts ? document.fonts.ready : Promise.resolve());
      await repPage.waitForTimeout(400);
      // Descend past any ancestor-context wrappers we added so we screenshot
      // the actual captured component — not the whole-page wrapper.
      let repRoot = null;
      for (const sel of [
        'body > div[data-ed-ancestor-context] > div[data-ed-parent-layout] > *',
        'body > div[data-ed-ancestor-context] > *:not([data-ed-parent-layout])',
        'body > div[data-ed-parent-layout] > *',
        'body > *:not([data-ed-ancestor-context]):not([data-ed-parent-layout])'
      ]) {
        repRoot = await repPage.$(sel);
        if (repRoot) break;
      }
      if (!repRoot) { results.push({ site: site.name, type: cap.type, skipped: 'repro-no-root' }); await repPage.close(); continue; }
      await repRoot.screenshot({ path: repPath, animations: 'disabled', omitBackground: false });
    } catch (e) {
      results.push({ site: site.name, type: cap.type, skipped: `repro:${e.message.slice(0, 40)}` });
      await repPage.close();
      continue;
    }
    await repPage.close();

    // Pixel diff. Resize to the smaller of the two dimensions so we compare
    // overlapping regions (avoids `pixelmatch` dimension-mismatch errors when
    // the reproduction is slightly different size).
    const orig = loadPng(origPath);
    const repr = loadPng(repPath);
    const w = Math.min(orig.width, repr.width);
    const h = Math.min(orig.height, repr.height);

    // Crop both to w × h from top-left
    function crop(png, W, H) {
      const out = new PNG({ width: W, height: H });
      for (let y = 0; y < H; y++) {
        const srcOff = (y * png.width) * 4;
        const dstOff = (y * W) * 4;
        png.data.copy(out.data, dstOff, srcOff, srcOff + W * 4);
      }
      return out;
    }
    const origCrop = crop(orig, w, h);
    const reprCrop = crop(repr, w, h);
    const diffImg = new PNG({ width: w, height: h });
    const pm = await getPixelmatch();
    const numDiff = pm(origCrop.data, reprCrop.data, diffImg.data, w, h, {
      threshold: 0.1,  // per-pixel color tolerance (0-1, higher = more lenient)
      includeAA: true  // consider anti-aliasing as a difference
    });
    const diffPath = `${OUT_DIR}/${site.name.replace(/\W+/g, '')}-${cap.type}-diff.png`;
    fs.writeFileSync(diffPath, PNG.sync.write(diffImg));

    const totalPx = w * h;
    const matchPct = (totalPx - numDiff) / totalPx;
    const sizeMatchPct = (Math.min(orig.width, repr.width) / Math.max(orig.width, repr.width)) *
                        (Math.min(orig.height, repr.height) / Math.max(orig.height, repr.height));
    results.push({
      site: site.name,
      type: cap.type,
      origSize: `${orig.width}x${orig.height}`,
      reprSize: `${repr.width}x${repr.height}`,
      pixelMatch: matchPct,
      sizeMatch: sizeMatchPct,
      diffPath
    });
    console.log(`    [${cap.type.padEnd(7)}] ${orig.width}×${orig.height} → ${repr.width}×${repr.height}  pixel-match=${pct(matchPct)}  size-match=${pct(sizeMatchPct)}`);
  }

  await ctx.close();
  return results;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const all = [];
  for (const site of TARGETS) {
    const rs = await captureAndRender(browser, site);
    all.push(...rs);
  }
  await browser.close();

  console.log('\n\n===== Fidelity summary =====');
  console.log('Site           Type      Orig size     Repro size    Pixel  Size');
  console.log('──────────────────────────────────────────────────────────────────');
  let totalPx = 0, samples = 0;
  for (const r of all) {
    if (r.skipped) {
      console.log(`${r.site.padEnd(14)} ${r.type.padEnd(8)} skipped (${r.skipped})`);
      continue;
    }
    console.log(
      `${r.site.padEnd(14)} ${r.type.padEnd(8)} ` +
      `${r.origSize.padEnd(13)} ${r.reprSize.padEnd(13)} ` +
      `${pct(r.pixelMatch).padStart(5)}  ${pct(r.sizeMatch).padStart(5)}`
    );
    totalPx += r.pixelMatch;
    samples++;
  }
  if (samples > 0) {
    console.log(`\nMean pixel-match across ${samples} samples: ${pct(totalPx / samples)}`);
  }
  console.log(`\nDiff images saved to ${OUT_DIR}/`);
})().catch(e => { console.error(e); process.exit(1); });
