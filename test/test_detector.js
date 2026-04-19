// Integration test — runs detector against real-world HTML fixtures.
// `node test_detector.js` prints a report per site.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { scanPage, TYPE, _internal } = require('../detector.js');

// ---------- unit tests for internal helpers ----------
let unitPass = 0, unitFail = 0;
function assert(desc, a, b) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (eq) { console.log(`  ✅ ${desc}`); unitPass++; }
  else { console.log(`  ❌ ${desc}\n     expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); unitFail++; }
}

console.log('\n== detector unit tests ==');
assert('strips react hash', _internal.normalizeClassToken('hero_a8b3f9'), 'hero');
assert('strips trailing hex', _internal.normalizeClassToken('button-deadbeef'), 'button');
assert('strips css-hash class entirely', _internal.normalizeClassToken('css-1a2b3c'), '');
assert('strips sc-hash class entirely', _internal.normalizeClassToken('sc-abc123-0'), '');
assert('keeps plain class', _internal.normalizeClassToken('card__title'), 'card__title');
assert('keeps short names', _internal.normalizeClassToken('btn'), 'btn');
assert('lowercases', _internal.normalizeClassToken('Nav'), 'nav');

// Signature test — structural signature should match even when classes differ
{
  const dom = new JSDOM('<div><div class="card_aaaaa"><span>a</span></div><div class="card_bbbbb"><span>b</span></div></div>');
  const first = dom.window.document.querySelector('div > div:nth-child(1)');
  const second = dom.window.document.querySelector('div > div:nth-child(2)');
  assert('sibling signatures match via structure (same tag, same child tags)',
    _internal.childSignature(first),
    _internal.childSignature(second));
}

// filterNested — SECTION drops when it contains a dominant type; leaves always survive
{
  const dom = new JSDOM('<section id="s"><nav id="n"><button id="b"></button></nav></section>');
  const s = dom.window.document.getElementById('s');
  const n = dom.window.document.getElementById('n');
  const b = dom.window.document.getElementById('b');
  const filtered = _internal.filterNested([
    { el: s, type: TYPE.SECTION, score: 90 },
    { el: n, type: TYPE.NAV,     score: 90 },
    { el: b, type: TYPE.BUTTON,  score: 80 }
  ]);
  assert('section dropped, nav+button kept', filtered.map(c => c.el.id).sort(), ['b', 'n']);
}

// Nested dominant-of-same-type is deduped
{
  const dom = new JSDOM('<nav id="outer"><nav id="inner"></nav></nav>');
  const outer = dom.window.document.getElementById('outer');
  const inner = dom.window.document.getElementById('inner');
  const filtered = _internal.filterNested([
    { el: outer, type: TYPE.NAV, score: 90 },
    { el: inner, type: TYPE.NAV, score: 90 }
  ]);
  assert('nav-in-nav → outer wins', filtered.map(c => c.el.id), ['outer']);
}

// Button nested inside nav still surfaces separately
{
  const dom = new JSDOM('<nav id="n"><button id="b"></button></nav>');
  const n = dom.window.document.getElementById('n');
  const b = dom.window.document.getElementById('b');
  const filtered = _internal.filterNested([
    { el: n, type: TYPE.NAV,    score: 90 },
    { el: b, type: TYPE.BUTTON, score: 80 }
  ]);
  assert('button inside nav survives', filtered.map(c => c.el.id).sort(), ['b', 'n']);
}

// Shadow DOM — scanPage must find components inside attached shadow roots
{
  const dom = new JSDOM('<div id="host"></div>');
  const host = dom.window.document.getElementById('host');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<nav id="inner-nav"><button>X</button></nav>';
  const result = scanPage(dom.window.document);
  const navs = (result.groups.nav || []);
  assert('nav inside shadow root is found', navs.length, 1);
}

// ---------- integration tests against real HTML ----------

const FIXTURES = [
  { name: 'Hacker News',    file: 'fixtures/hn.html' },
  { name: 'Vercel',         file: 'fixtures/vercel.html' },
  { name: 'Linear',         file: 'fixtures/linear.html' },
  { name: 'Tailwind UI',    file: 'fixtures/tailwindui.html' },
  { name: 'Stripe Pricing', file: 'fixtures/stripe-pricing.html' }
];

console.log('\n== detector against real-world HTML ==\n');

for (const fx of FIXTURES) {
  const filepath = path.join(__dirname, fx.file);
  if (!fs.existsSync(filepath)) { console.log(`  (skip ${fx.name} — no fixture)\n`); continue; }
  const html = fs.readFileSync(filepath, 'utf8');
  if (html.length < 500) { console.log(`  (skip ${fx.name} — fixture too small)\n`); continue; }

  const dom = new JSDOM(html);
  const t0 = Date.now();
  let result;
  try {
    result = scanPage(dom.window.document);
  } catch (e) {
    console.log(`  ❌ ${fx.name}: threw ${e.message}\n`);
    continue;
  }
  const ms = Date.now() - t0;

  console.log(`▸ ${fx.name}  (${(html.length / 1024).toFixed(0)}KB, ${ms}ms)`);
  console.log(`  total candidates: ${result.candidates.length}`);
  for (const [type, list] of Object.entries(result.groups)) {
    console.log(`    ${type.padEnd(8)} × ${list.length}`);
  }

  // Show a few examples per category
  const EXAMPLES_PER_TYPE = 2;
  for (const [type, list] of Object.entries(result.groups)) {
    const top = list.slice(0, EXAMPLES_PER_TYPE);
    for (const c of top) {
      const el = c.el;
      const cls = (el.className && typeof el.className === 'string' ? el.className : el.getAttribute && el.getAttribute('class')) || '';
      const snippet = `<${el.tagName.toLowerCase()}${cls ? ` class="${cls.slice(0, 40)}${cls.length > 40 ? '…' : ''}"` : ''}>`;
      console.log(`      · [${c.score}] ${snippet}  — ${c.reason}${c.clusterCount ? ` (${c.clusterCount}×)` : ''}`);
    }
  }
  console.log('');
}

console.log(`\nUnit: ${unitPass} passed, ${unitFail} failed`);
if (unitFail > 0) process.exit(1);
