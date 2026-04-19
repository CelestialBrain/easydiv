// Unit tests for pure converters. Run with: node test_pxToTw.js
// These mirror the logic in content.js. Keep in sync.

// ---------- pxToTw ----------
const TW_SPACING_MAP = {
    '0px': '0', '1px': 'px', '2px': '0.5', '4px': '1', '6px': '1.5', '8px': '2',
    '10px': '2.5', '12px': '3', '14px': '3.5', '16px': '4', '20px': '5', '24px': '6',
    '28px': '7', '32px': '8', '36px': '9', '40px': '10', '44px': '11', '48px': '12',
    '56px': '14', '64px': '16', '80px': '20', '96px': '24', '112px': '28', '128px': '32',
    '144px': '36', '160px': '40', '176px': '44', '192px': '48', '208px': '52', '224px': '56',
    '240px': '60', '256px': '64', '288px': '72', '320px': '80', '384px': '96'
};
const TW_VALUES = Object.keys(TW_SPACING_MAP).map(k => parseFloat(k)).sort((a, b) => a - b);

function pxToTw(val) {
    if (!val || val === '0px' || val === 'auto' || val === '0') return null;
    if (TW_SPACING_MAP[val]) return TW_SPACING_MAP[val];
    const isNegative = val.startsWith('-');
    const px = parseFloat(val);
    if (isNaN(px)) return `[${val}]`;
    const absPx = Math.abs(px);
    let closest = TW_VALUES[0];
    let minDiff = Math.abs(absPx - closest);
    for (let i = 1; i < TW_VALUES.length; i++) {
        const diff = Math.abs(absPx - TW_VALUES[i]);
        if (diff <= minDiff) { minDiff = diff; closest = TW_VALUES[i]; }
    }
    let twValue;
    if (minDiff <= 2.5) twValue = TW_SPACING_MAP[`${closest}px`];
    else twValue = `[${absPx}px]`;
    return isNegative ? `-${twValue}` : twValue;
}

// ---------- normalizeColor ----------
// Mirror of the palette-aware normalizeColor in content.js.
// Subset of Tailwind palette for test — add more as needed.
const TW_PALETTE = new Map([
    ['239,68,68', 'red-500'],
    ['59,130,246', 'blue-500'],
    ['34,197,94', 'green-500'],
    ['139,92,246', 'violet-500'],
    ['249,115,22', 'orange-500'],
    ['0,0,0', 'black'],
    ['255,255,255', 'white'],
]);
const TW_OPACITY_TIERS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

function normalizeColor(color) {
    if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') return null;
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbaMatch) {
        const [, r, g, b, a] = rgbaMatch;
        const key = `${r},${g},${b}`;
        const paletteName = TW_PALETTE.get(key);
        const alpha = a !== undefined ? parseFloat(a) : 1;

        if (alpha >= 1) {
            if (paletteName) return paletteName;
            return `[rgb(${r},${g},${b})]`;
        }
        if (paletteName) {
            const pct = Math.round(alpha * 100);
            let closest = TW_OPACITY_TIERS[0], minDiff = Math.abs(pct - closest);
            for (const t of TW_OPACITY_TIERS) {
                const d = Math.abs(pct - t);
                if (d < minDiff) { minDiff = d; closest = t; }
            }
            if (minDiff <= 2) return `${paletteName}/${closest}`;
            return `${paletteName}/[${pct}%]`;
        }
        return `[${color.replace(/\s/g, '')}]`;
    }
    return `[${color.replace(/\s/g, '')}]`;
}

// ---------- radiusToTw ----------
const RADIUS_NAMED = {
    '0px': 'none', '2px': 'sm', '4px': '', '6px': 'md', '8px': 'lg',
    '12px': 'xl', '16px': '2xl', '24px': '3xl', '9999px': 'full'
};
function radiusToTw(val) {
    if (RADIUS_NAMED[val] !== undefined) {
        return RADIUS_NAMED[val] === '' ? 'rounded' : `rounded-${RADIUS_NAMED[val]}`;
    }
    const tw = pxToTw(val);
    if (!tw) return null;
    return tw.startsWith('[') ? `rounded-${tw}` : `rounded-${tw}`;
}

// ---------- parseMatrix ----------
function parseMatrix(str) {
    const m = str.match(/^matrix\(([^)]+)\)/);
    if (!m) return null;
    const [a, b, c, d, tx, ty] = m[1].split(',').map(parseFloat);
    const scaleX = Math.sqrt(a * a + b * b);
    const scaleY = Math.sqrt(c * c + d * d);
    const rotate = Math.atan2(b, a) * 180 / Math.PI;
    return { scaleX, scaleY, rotate, tx, ty };
}

// ---------- mediaToPrefix ----------
function mediaToPrefix(mediaText) {
    const m = mediaText.match(/min-width:\s*(\d+)px/);
    if (!m) return '';
    const px = parseInt(m[1]);
    if (px === 640) return 'sm:';
    if (px === 768) return 'md:';
    if (px === 1024) return 'lg:';
    if (px === 1280) return 'xl:';
    if (px === 1536) return '2xl:';
    return `min-[${px}px]:`;
}

// ---------- splitSelectorState ----------
const PSEUDO_VARIANT_MAP = {
    'hover': 'hover', 'focus': 'focus', 'focus-visible': 'focus-visible',
    'focus-within': 'focus-within', 'active': 'active', 'disabled': 'disabled',
    'checked': 'checked', 'visited': 'visited', 'placeholder-shown': 'placeholder-shown',
    'first-child': 'first', 'last-child': 'last', 'only-child': 'only',
    'odd': 'odd', 'even': 'even', 'empty': 'empty', 'required': 'required',
    'optional': 'optional', 'read-only': 'read-only', 'invalid': 'invalid'
};
function splitSelectorState(sel) {
    if (/:not\(|:has\(|:is\(|:where\(/.test(sel)) return { baseSelector: null, statePrefix: '' };
    const pseudoRegex = /(?<!:):([a-z-]+)(?![a-z-])/gi;
    let match, lastMatch = null;
    while ((match = pseudoRegex.exec(sel)) !== null) {
        if (PSEUDO_VARIANT_MAP[match[1]]) lastMatch = { name: match[1], idx: match.index, full: match[0] };
    }
    if (!lastMatch) return { baseSelector: sel, statePrefix: '' };
    const base = sel.slice(0, lastMatch.idx) + sel.slice(lastMatch.idx + lastMatch.full.length);
    return { baseSelector: base || '*', statePrefix: `${PSEUDO_VARIANT_MAP[lastMatch.name]}:` };
}

// =============================================================================
// TESTS
// =============================================================================

let passed = 0, failed = 0;
function assert(desc, actual, expected) {
    const eq = typeof expected === 'object' && expected !== null
        ? JSON.stringify(actual) === JSON.stringify(expected)
        : actual === expected;
    if (eq) { console.log(`  ✅ ${desc}`); passed++; }
    else { console.log(`  ❌ ${desc}\n     expected: ${JSON.stringify(expected)}\n     got:      ${JSON.stringify(actual)}`); failed++; }
}
function near(a, b, tol = 0.01) { return Math.abs(a - b) < tol; }
function assertNear(desc, actual, expected, tol = 0.01) {
    if (near(actual, expected, tol)) { console.log(`  ✅ ${desc}`); passed++; }
    else { console.log(`  ❌ ${desc}  got ${actual}, expected ~${expected}`); failed++; }
}

console.log('\n== pxToTw ==');
assert('16px → 4', pxToTw('16px'), '4');
assert('15px → 4 (snap up)', pxToTw('15px'), '4');
assert('17px → 4 (snap down)', pxToTw('17px'), '4');
assert('2px → 0.5', pxToTw('2px'), '0.5');
assert('2.4px → 0.5', pxToTw('2.4px'), '0.5');
assert('3.5px → 1', pxToTw('3.5px'), '1');
assert('-16px → -4', pxToTw('-16px'), '-4');
assert('"0" → null', pxToTw('0'), null);
assert('"0px" → null', pxToTw('0px'), null);
assert('1000px → arbitrary', pxToTw('1000px'), '[1000px]');

console.log('\n== normalizeColor ==');
assert('solid rgb not in palette', normalizeColor('rgb(255, 0, 0)'), '[rgb(255,0,0)]');
assert('rgba solid (α=1)', normalizeColor('rgba(255, 0, 0, 1)'), '[rgb(255,0,0)]');
assert('rgba with alpha', normalizeColor('rgba(255, 0, 0, 0.5)'), '[rgba(255,0,0,0.5)]');
assert('transparent → null', normalizeColor('transparent'), null);
assert('rgba(0,0,0,0) → null', normalizeColor('rgba(0, 0, 0, 0)'), null);
assert('hex passthrough', normalizeColor('#ff0000'), '[#ff0000]');

// Palette matching
assert('red-500 exact rgb', normalizeColor('rgb(239, 68, 68)'), 'red-500');
assert('blue-500 exact rgb', normalizeColor('rgb(59, 130, 246)'), 'blue-500');
assert('black special', normalizeColor('rgb(0, 0, 0)'), 'black');
assert('white special', normalizeColor('rgb(255, 255, 255)'), 'white');
assert('palette + alpha tier', normalizeColor('rgba(239, 68, 68, 0.5)'), 'red-500/50');
assert('palette + alpha snaps down', normalizeColor('rgba(239, 68, 68, 0.26)'), 'red-500/25');
assert('palette + off-tier still snaps (tolerance=2)', normalizeColor('rgba(239, 68, 68, 0.37)'), 'red-500/35');

console.log('\n== radiusToTw ==');
assert('0px → rounded-none', radiusToTw('0px'), 'rounded-none');
assert('2px → rounded-sm', radiusToTw('2px'), 'rounded-sm');
assert('4px → rounded', radiusToTw('4px'), 'rounded');
assert('8px → rounded-lg', radiusToTw('8px'), 'rounded-lg');
assert('9999px → rounded-full', radiusToTw('9999px'), 'rounded-full');
assert('5px → rounded-1.5 (snap)', radiusToTw('5px'), 'rounded-1.5');

console.log('\n== parseMatrix ==');
const identity = parseMatrix('matrix(1, 0, 0, 1, 0, 0)');
assertNear('identity scaleX=1', identity.scaleX, 1);
assertNear('identity scaleY=1', identity.scaleY, 1);
assertNear('identity rotate=0', identity.rotate, 0);
assertNear('identity tx=0', identity.tx, 0);

const scaled = parseMatrix('matrix(1.5, 0, 0, 1.5, 0, 0)');
assertNear('scale(1.5) scaleX', scaled.scaleX, 1.5);
assertNear('scale(1.5) scaleY', scaled.scaleY, 1.5);

const translated = parseMatrix('matrix(1, 0, 0, 1, 10, 20)');
assertNear('translate tx', translated.tx, 10);
assertNear('translate ty', translated.ty, 20);

// rotate(45deg) → matrix(0.7071, 0.7071, -0.7071, 0.7071, 0, 0)
const rotated = parseMatrix('matrix(0.7071, 0.7071, -0.7071, 0.7071, 0, 0)');
assertNear('rotate(45) rotation deg', rotated.rotate, 45, 0.1);

assert('matrix3d not supported → null', parseMatrix('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)'), null);

console.log('\n== mediaToPrefix ==');
assert('640px → sm:', mediaToPrefix('(min-width: 640px)'), 'sm:');
assert('768px → md:', mediaToPrefix('(min-width: 768px)'), 'md:');
assert('1024px → lg:', mediaToPrefix('(min-width: 1024px)'), 'lg:');
assert('1280px → xl:', mediaToPrefix('(min-width: 1280px)'), 'xl:');
assert('1536px → 2xl:', mediaToPrefix('(min-width: 1536px)'), '2xl:');
assert('900px → min-[900px]:', mediaToPrefix('(min-width: 900px)'), 'min-[900px]:');
assert('max-width → ""', mediaToPrefix('(max-width: 900px)'), '');

console.log('\n== splitSelectorState ==');
assert('plain selector', splitSelectorState('.btn'), { baseSelector: '.btn', statePrefix: '' });
assert(':hover', splitSelectorState('.btn:hover'), { baseSelector: '.btn', statePrefix: 'hover:' });
assert(':focus', splitSelectorState('a:focus'), { baseSelector: 'a', statePrefix: 'focus:' });
assert(':disabled', splitSelectorState('button:disabled'), { baseSelector: 'button', statePrefix: 'disabled:' });
assert(':first-child → first:', splitSelectorState('li:first-child'), { baseSelector: 'li', statePrefix: 'first:' });
assert('skip :not()', splitSelectorState('.btn:not(.disabled)'), { baseSelector: null, statePrefix: '' });
assert('double colon kept in base', splitSelectorState('.btn::before'), { baseSelector: '.btn::before', statePrefix: '' });
assert(':hover::before', splitSelectorState('.btn:hover::before'), { baseSelector: '.btn::before', statePrefix: 'hover:' });

// ---------- gradient parser (mirror of content.js) ----------
const GRADIENT_ANGLE_MAP = {
    '0deg': 't', '0': 't',
    '45deg': 'tr',
    '90deg': 'r',
    '135deg': 'br',
    '180deg': 'b',
    '225deg': 'bl',
    '270deg': 'l',
    '315deg': 'tl',
    '360deg': 't',
    'to top': 't',
    'to top right': 'tr', 'to right top': 'tr',
    'to right': 'r',
    'to bottom right': 'br', 'to right bottom': 'br',
    'to bottom': 'b',
    'to bottom left': 'bl', 'to left bottom': 'bl',
    'to left': 'l',
    'to top left': 'tl', 'to left top': 'tl'
};
function splitByTopLevelComma(s) {
    const out = []; let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
    }
    out.push(s.slice(start).trim());
    return out;
}
function parseGradientStop(stop) {
    let depth = 0, splitAt = -1;
    for (let i = 0; i < stop.length; i++) {
        if (stop[i] === '(') depth++;
        else if (stop[i] === ')') depth--;
        else if (stop[i] === ' ' && depth === 0) splitAt = i;
    }
    if (splitAt < 0) return { color: stop, position: null };
    const left = stop.slice(0, splitAt).trim();
    const right = stop.slice(splitAt).trim();
    if (/^-?\d+(\.\d+)?(%|px|rem|em)?$/.test(right)) return { color: left, position: right };
    return { color: stop, position: null };
}
function parseLinearGradient(value) {
    const m = value.match(/^linear-gradient\(([\s\S]+)\)$/);
    if (!m) return null;
    const parts = splitByTopLevelComma(m[1]);
    if (parts.length < 2) return null;
    let dirText = parts[0]; let stops;
    if (/^to\s/.test(dirText) || /(deg|turn|rad|grad)$/.test(dirText) || dirText === '0') stops = parts.slice(1);
    else { dirText = '180deg'; stops = parts; }
    let dirKey = dirText.trim().toLowerCase().replace(/\s+/g, ' ');
    if (dirKey.endsWith('turn')) dirKey = `${parseFloat(dirKey) * 360}deg`;
    if (dirKey.endsWith('rad')) dirKey = `${Math.round(parseFloat(dirKey) * 180 / Math.PI)}deg`;
    if (dirKey.endsWith('grad')) dirKey = `${Math.round(parseFloat(dirKey) * 0.9)}deg`;
    const dir = GRADIENT_ANGLE_MAP[dirKey];
    if (!dir) return null;
    if (stops.length < 2 || stops.length > 3) return null;
    const parsedStops = stops.map(parseGradientStop);
    const positioned = parsedStops.filter(s => s.position !== null);
    if (positioned.length > 0 && positioned.length !== parsedStops.length) return null;
    if (positioned.length === parsedStops.length) {
        const expected = parsedStops.length === 2 ? ['0%', '100%'] : ['0%', '50%', '100%'];
        if (!parsedStops.every((s, i) => s.position === expected[i])) return null;
    }
    return { dir, stops: parsedStops.map(s => s.color) };
}

console.log('\n== linear-gradient parser ==');
assert('90deg → r, 2 stops',
    parseLinearGradient('linear-gradient(90deg, red, blue)'),
    { dir: 'r', stops: ['red', 'blue'] });
assert('to right → r',
    parseLinearGradient('linear-gradient(to right, red, blue)'),
    { dir: 'r', stops: ['red', 'blue'] });
assert('default direction (bottom)',
    parseLinearGradient('linear-gradient(red, blue)'),
    { dir: 'b', stops: ['red', 'blue'] });
assert('3 stops via',
    parseLinearGradient('linear-gradient(135deg, #f00, #0f0, #00f)'),
    { dir: 'br', stops: ['#f00', '#0f0', '#00f'] });
assert('stops with rgb colors preserved',
    parseLinearGradient('linear-gradient(to bottom right, rgb(239, 68, 68), rgb(59, 130, 246))'),
    { dir: 'br', stops: ['rgb(239, 68, 68)', 'rgb(59, 130, 246)'] });
assert('0.5turn → 180deg → b',
    parseLinearGradient('linear-gradient(0.5turn, red, blue)'),
    { dir: 'b', stops: ['red', 'blue'] });
assert('unmapped angle → null',
    parseLinearGradient('linear-gradient(30deg, red, blue)'),
    null);
assert('4 stops → null (too complex)',
    parseLinearGradient('linear-gradient(90deg, red, orange, yellow, blue)'),
    null);
assert('non-canonical positions → null',
    parseLinearGradient('linear-gradient(90deg, red 20%, blue 80%)'),
    null);
assert('canonical positions (0%/100%) → ok',
    parseLinearGradient('linear-gradient(90deg, red 0%, blue 100%)'),
    { dir: 'r', stops: ['red', 'blue'] });
assert('radial-gradient → null (unsupported)',
    parseLinearGradient('radial-gradient(circle, red, blue)'),
    null);

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
