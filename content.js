// =============================================================================
// EasyDiv Engine v2
//
// Pure-code frontend component stealer. No AI, no backend.
// Reads computed styles + stylesheet rules and emits Tailwind / raw CSS.
//
// Sections:
//   1. Inspector state & highlighter UI
//   2. Conversion primitives (pxToTw, color, property → class)
//   3. Specialized generators (border, shadow, transform, transition, typography)
//   4. Keyword map + base class builder
//   5. Inline-style emitter (universal CSS)
//   6. Stylesheet scanner (variants: hover/focus/active/responsive + @keyframes)
//   7. Pseudo-element capture (::before / ::after)
//   8. Lottie detection
//   9. Cloner / freezer
//  10. Inspector event handlers + message bus
// =============================================================================

let inspectorActive = false;
let highlightBox = null;
let pseudoIdCounter = 0;

// =============================================================================
// 2. CONVERSION PRIMITIVES
// =============================================================================

const TW_SPACING_MAP = {
  '0px': '0', '1px': 'px', '2px': '0.5', '4px': '1', '6px': '1.5', '8px': '2',
  '10px': '2.5', '12px': '3', '14px': '3.5', '16px': '4', '20px': '5', '24px': '6',
  '28px': '7', '32px': '8', '36px': '9', '40px': '10', '44px': '11', '48px': '12',
  '56px': '14', '64px': '16', '80px': '20', '96px': '24', '112px': '28', '128px': '32',
  '144px': '36', '160px': '40', '176px': '44', '192px': '48', '208px': '52', '224px': '56',
  '240px': '60', '256px': '64', '288px': '72', '320px': '80', '384px': '96'
};

const TW_VALUES = Object.keys(TW_SPACING_MAP)
  .map(k => parseFloat(k))
  .sort((a, b) => a - b);

function pxToTw(val) {
  if (!val || val === '0px' || val === 'auto' || val === '0') return null;
  if (TW_SPACING_MAP[val]) return TW_SPACING_MAP[val];

  const isNegative = val.startsWith('-');
  const px = parseFloat(val);
  // Multi-value / keyword arbitraries need underscore-escaping for spaces so
  // Tailwind JIT parses them (e.g. `gap-[normal_24px]` not `gap-[normal 24px]`).
  if (isNaN(px)) return `[${val.replace(/\s+/g, '_')}]`;

  const absPx = Math.abs(px);

  let closest = TW_VALUES[0];
  let minDiff = Math.abs(absPx - closest);
  for (let i = 1; i < TW_VALUES.length; i++) {
    const diff = Math.abs(absPx - TW_VALUES[i]);
    if (diff <= minDiff) {
      minDiff = diff;
      closest = TW_VALUES[i];
    }
  }

  let twValue;
  if (minDiff <= 2.5) {
    twValue = TW_SPACING_MAP[`${closest}px`];
  } else {
    twValue = `[${absPx}px]`;
  }

  return isNegative ? `-${twValue}` : twValue;
}

// Minimal Tailwind-style preflight. Prepended to extraCss when copying in
// Universal/JSX modes so captures render correctly in contexts without a
// global CSS reset (plain HTML, CMS templates, email editors). Skips Tailwind
// and raw modes — those already have their own resets / preserve originals.
//
// Based on Tailwind's preflight v3. Trimmed comments, single-line for travel.
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
  ':-moz-focusring{outline:auto}',
  ':-moz-ui-invalid{box-shadow:none}',
  'progress{vertical-align:baseline}',
  '::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}',
  "[type='search']{-webkit-appearance:textfield;outline-offset:-2px}",
  '::-webkit-search-decoration{-webkit-appearance:none}',
  '::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}',
  'summary{display:list-item}',
  'blockquote,dl,dd,figure,pre{margin:0}',
  'fieldset{margin:0;padding:0}',
  'legend{padding:0}',
  'ol,ul,menu{list-style:none;margin:0;padding:0}',
  'textarea{resize:vertical}',
  'input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}',
  'button,[role="button"]{cursor:pointer}',
  ':disabled{cursor:default}',
  'img,svg,video,canvas,audio,iframe,embed,object{display:block;vertical-align:middle}',
  'img,video{max-width:100%;height:auto}',
  '[hidden]{display:none}'
].join('');

// Tailwind v3 default color palette. Matching a computed rgb to one of these
// lets us emit `bg-red-500` instead of `bg-[rgb(239,68,68)]` — big UX win, and
// a gap in DivMagic's output.
// Format: "r,g,b": "name-shade"
const TW_PALETTE = (() => {
  const raw = `
slate 50 248,250,252 | slate 100 241,245,249 | slate 200 226,232,240 | slate 300 203,213,225 | slate 400 148,163,184 | slate 500 100,116,139 | slate 600 71,85,105 | slate 700 51,65,85 | slate 800 30,41,59 | slate 900 15,23,42 | slate 950 2,6,23
gray 50 249,250,251 | gray 100 243,244,246 | gray 200 229,231,235 | gray 300 209,213,219 | gray 400 156,163,175 | gray 500 107,114,128 | gray 600 75,85,99 | gray 700 55,65,81 | gray 800 31,41,55 | gray 900 17,24,39 | gray 950 3,7,18
zinc 50 250,250,250 | zinc 100 244,244,245 | zinc 200 228,228,231 | zinc 300 212,212,216 | zinc 400 161,161,170 | zinc 500 113,113,122 | zinc 600 82,82,91 | zinc 700 63,63,70 | zinc 800 39,39,42 | zinc 900 24,24,27 | zinc 950 9,9,11
neutral 50 250,250,250 | neutral 100 245,245,245 | neutral 200 229,229,229 | neutral 300 212,212,212 | neutral 400 163,163,163 | neutral 500 115,115,115 | neutral 600 82,82,82 | neutral 700 64,64,64 | neutral 800 38,38,38 | neutral 900 23,23,23 | neutral 950 10,10,10
stone 50 250,250,249 | stone 100 245,245,244 | stone 200 231,229,228 | stone 300 214,211,209 | stone 400 168,162,158 | stone 500 120,113,108 | stone 600 87,83,78 | stone 700 68,64,60 | stone 800 41,37,36 | stone 900 28,25,23 | stone 950 12,10,9
red 50 254,242,242 | red 100 254,226,226 | red 200 254,202,202 | red 300 252,165,165 | red 400 248,113,113 | red 500 239,68,68 | red 600 220,38,38 | red 700 185,28,28 | red 800 153,27,27 | red 900 127,29,29 | red 950 69,10,10
orange 50 255,247,237 | orange 100 255,237,213 | orange 200 254,215,170 | orange 300 253,186,116 | orange 400 251,146,60 | orange 500 249,115,22 | orange 600 234,88,12 | orange 700 194,65,12 | orange 800 154,52,18 | orange 900 124,45,18 | orange 950 67,20,7
amber 50 255,251,235 | amber 100 254,243,199 | amber 200 253,230,138 | amber 300 252,211,77 | amber 400 251,191,36 | amber 500 245,158,11 | amber 600 217,119,6 | amber 700 180,83,9 | amber 800 146,64,14 | amber 900 120,53,15 | amber 950 69,26,3
yellow 50 254,252,232 | yellow 100 254,249,195 | yellow 200 254,240,138 | yellow 300 253,224,71 | yellow 400 250,204,21 | yellow 500 234,179,8 | yellow 600 202,138,4 | yellow 700 161,98,7 | yellow 800 133,77,14 | yellow 900 113,63,18 | yellow 950 66,32,6
lime 50 247,254,231 | lime 100 236,252,203 | lime 200 217,249,157 | lime 300 190,242,100 | lime 400 163,230,53 | lime 500 132,204,22 | lime 600 101,163,13 | lime 700 77,124,15 | lime 800 63,98,18 | lime 900 54,83,20 | lime 950 26,46,5
green 50 240,253,244 | green 100 220,252,231 | green 200 187,247,208 | green 300 134,239,172 | green 400 74,222,128 | green 500 34,197,94 | green 600 22,163,74 | green 700 21,128,61 | green 800 22,101,52 | green 900 20,83,45 | green 950 5,46,22
emerald 50 236,253,245 | emerald 100 209,250,229 | emerald 200 167,243,208 | emerald 300 110,231,183 | emerald 400 52,211,153 | emerald 500 16,185,129 | emerald 600 5,150,105 | emerald 700 4,120,87 | emerald 800 6,95,70 | emerald 900 6,78,59 | emerald 950 2,44,34
teal 50 240,253,250 | teal 100 204,251,241 | teal 200 153,246,228 | teal 300 94,234,212 | teal 400 45,212,191 | teal 500 20,184,166 | teal 600 13,148,136 | teal 700 15,118,110 | teal 800 17,94,89 | teal 900 19,78,74 | teal 950 4,47,46
cyan 50 236,254,255 | cyan 100 207,250,254 | cyan 200 165,243,252 | cyan 300 103,232,249 | cyan 400 34,211,238 | cyan 500 6,182,212 | cyan 600 8,145,178 | cyan 700 14,116,144 | cyan 800 21,94,117 | cyan 900 22,78,99 | cyan 950 8,51,68
sky 50 240,249,255 | sky 100 224,242,254 | sky 200 186,230,253 | sky 300 125,211,252 | sky 400 56,189,248 | sky 500 14,165,233 | sky 600 2,132,199 | sky 700 3,105,161 | sky 800 7,89,133 | sky 900 12,74,110 | sky 950 8,47,73
blue 50 239,246,255 | blue 100 219,234,254 | blue 200 191,219,254 | blue 300 147,197,253 | blue 400 96,165,250 | blue 500 59,130,246 | blue 600 37,99,235 | blue 700 29,78,216 | blue 800 30,64,175 | blue 900 30,58,138 | blue 950 23,37,84
indigo 50 238,242,255 | indigo 100 224,231,255 | indigo 200 199,210,254 | indigo 300 165,180,252 | indigo 400 129,140,248 | indigo 500 99,102,241 | indigo 600 79,70,229 | indigo 700 67,56,202 | indigo 800 55,48,163 | indigo 900 49,46,129 | indigo 950 30,27,75
violet 50 245,243,255 | violet 100 237,233,254 | violet 200 221,214,254 | violet 300 196,181,253 | violet 400 167,139,250 | violet 500 139,92,246 | violet 600 124,58,237 | violet 700 109,40,217 | violet 800 91,33,182 | violet 900 76,29,149 | violet 950 46,16,101
purple 50 250,245,255 | purple 100 243,232,255 | purple 200 233,213,255 | purple 300 216,180,254 | purple 400 192,132,252 | purple 500 168,85,247 | purple 600 147,51,234 | purple 700 126,34,206 | purple 800 107,33,168 | purple 900 88,28,135 | purple 950 59,7,100
fuchsia 50 253,244,255 | fuchsia 100 250,232,255 | fuchsia 200 245,208,254 | fuchsia 300 240,171,252 | fuchsia 400 232,121,249 | fuchsia 500 217,70,239 | fuchsia 600 192,38,211 | fuchsia 700 162,28,175 | fuchsia 800 134,25,143 | fuchsia 900 112,26,117 | fuchsia 950 74,4,78
pink 50 253,242,248 | pink 100 252,231,243 | pink 200 251,207,232 | pink 300 249,168,212 | pink 400 244,114,182 | pink 500 236,72,153 | pink 600 219,39,119 | pink 700 190,24,93 | pink 800 157,23,77 | pink 900 131,24,67 | pink 950 80,7,36
rose 50 255,241,242 | rose 100 255,228,230 | rose 200 254,205,211 | rose 300 253,164,175 | rose 400 251,113,133 | rose 500 244,63,94 | rose 600 225,29,72 | rose 700 190,18,60 | rose 800 159,18,57 | rose 900 136,19,55 | rose 950 76,5,25
  `;
  const out = new Map();
  for (const line of raw.split('\n')) {
    const entries = line.trim().split('|');
    for (const e of entries) {
      const parts = e.trim().split(/\s+/);
      if (parts.length !== 3) continue;
      const [name, shade, rgb] = parts;
      out.set(rgb, `${name}-${shade}`);
    }
  }
  // Special cases outside the palette
  out.set('0,0,0', 'black');
  out.set('255,255,255', 'white');
  return out;
})();

// Opacity tiers Tailwind supports via `/NN` notation.
const TW_OPACITY_TIERS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];

// User-defined palette, populated from chrome.storage.local.userPalette. Entries
// take precedence over the default Tailwind palette when RGB keys collide —
// so a project's `primary: #3b82f6` wins over the default `blue-500: #3b82f6`.
// Loaded async at script init; first capture before load falls back to defaults.
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  try {
    chrome.storage.local.get({ userPalette: {} }, (res) => {
      const up = res && res.userPalette;
      if (up && typeof up === 'object') {
        for (const [k, v] of Object.entries(up)) TW_PALETTE.set(k, v);
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.userPalette) return;
      // Rebuild: wipe non-default user entries (we tag by checking: default
      // entries all have hyphenated `name-shade` or are `black`/`white`). Simpler
      // rule: on change, just re-apply the new palette on top of defaults. Since
      // TW_PALETTE is a live Map we can't easily tell who's from where, so we
      // reload the extension context — but a next-page-load refresh is enough.
      const next = changes.userPalette.newValue || {};
      for (const [k, v] of Object.entries(next)) TW_PALETTE.set(k, v);
    });
  } catch (e) { /* running outside extension context (tests) */ }
}

// Converts a CSS color string to a Tailwind token suffix.
// Returns e.g. "red-500", "red-500/50", "[rgb(239,68,68)]", or "[rgba(...)]".
// Returns null for transparent / missing colors.
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
    // With transparency
    if (paletteName) {
      const pct = Math.round(alpha * 100);
      // Snap to nearest Tailwind opacity tier
      let closest = TW_OPACITY_TIERS[0], minDiff = Math.abs(pct - closest);
      for (const t of TW_OPACITY_TIERS) {
        const d = Math.abs(pct - t);
        if (d < minDiff) { minDiff = d; closest = t; }
      }
      if (minDiff <= 2) return `${paletteName}/${closest}`;
      return `${paletteName}/[${pct}%]`;
    }
    // rgba fallback — build clean from captured parts (no spaces, Tailwind-safe)
    return `[rgba(${r},${g},${b},${a})]`;
  }
  // Non-rgb colors (hex, hsl, lab, oklch, color()…) — preserve structure,
  // escape whitespace with underscores so Tailwind JIT accepts it.
  return `[${color.replace(/\s+/g, '_')}]`;
}

// Radii tailwind has named tiers for. We prefer these when they match.
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

// =============================================================================
// 3. SPECIALIZED GENERATORS
// =============================================================================

// --- Borders ---
function genBorders(cs, out) {
  const sides = ['top', 'right', 'bottom', 'left'];
  const widths = sides.map(s => cs.getPropertyValue(`border-${s}-width`));
  const styles = sides.map(s => cs.getPropertyValue(`border-${s}-style`));
  const colors = sides.map(s => cs.getPropertyValue(`border-${s}-color`));

  const allEq = arr => arr.every(v => v === arr[0]);

  // Width
  if (widths.some(w => w && w !== '0px')) {
    if (allEq(widths) && widths[0] !== '0px') {
      const px = parseFloat(widths[0]);
      if (px === 1) out.push('border');
      else if (px === 2) out.push('border-2');
      else if (px === 4) out.push('border-4');
      else if (px === 8) out.push('border-8');
      else out.push(`border-[${widths[0]}]`);
    } else {
      const sideAbbr = { top: 't', right: 'r', bottom: 'b', left: 'l' };
      widths.forEach((w, i) => {
        if (!w || w === '0px') return;
        const px = parseFloat(w);
        const ab = sideAbbr[sides[i]];
        if (px === 1) out.push(`border-${ab}`);
        else if ([2, 4, 8].includes(px)) out.push(`border-${ab}-${px}`);
        else out.push(`border-${ab}-[${w}]`);
      });
    }
  }

  // Style (solid is default in Tailwind, only emit non-default)
  if (allEq(styles) && styles[0] && styles[0] !== 'solid' && styles[0] !== 'none') {
    out.push(`border-${styles[0]}`);
  }

  // Color (only if any width > 0)
  if (widths.some(w => w && w !== '0px') && allEq(colors) && colors[0]) {
    const c = normalizeColor(colors[0]);
    if (c) out.push(`border-${c}`);
  }

  // Radius (per corner)
  const cornerProps = [
    ['top-left', 'tl'], ['top-right', 'tr'],
    ['bottom-right', 'br'], ['bottom-left', 'bl']
  ];
  const radii = cornerProps.map(([css]) => cs.getPropertyValue(`border-${css}-radius`));
  if (radii.some(r => r && r !== '0px')) {
    if (allEq(radii)) {
      const r = radiusToTw(radii[0]);
      if (r) out.push(r);
    } else {
      cornerProps.forEach(([, abbr], i) => {
        const r = radii[i];
        if (!r || r === '0px') return;
        const tw = radiusToTw(r);
        if (!tw) return;
        // rounded-tl-lg, rounded-tl-[5px], etc.
        out.push(tw.replace(/^rounded(-|$)/, `rounded-${abbr}$1`));
      });
    }
  }
}

// --- Shadow ---
// Common named shadow patterns (Tailwind defaults)
const SHADOW_NAMED = {
  'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px': 'shadow-sm',
  'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px': 'shadow',
  'rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.1) 0px 2px 4px -2px': 'shadow-md',
  'rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px': 'shadow-lg',
  'rgba(0, 0, 0, 0.1) 0px 20px 25px -5px, rgba(0, 0, 0, 0.1) 0px 8px 10px -6px': 'shadow-xl',
  'rgba(0, 0, 0, 0.25) 0px 25px 50px -12px': 'shadow-2xl',
  'rgba(0, 0, 0, 0.05) 0px 2px 4px 0px inset': 'shadow-inner'
};

function genShadow(cs, out) {
  const raw = cs.getPropertyValue('box-shadow');
  if (!raw || raw === 'none') return;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (SHADOW_NAMED[normalized]) {
    out.push(SHADOW_NAMED[normalized]);
    return;
  }
  // Arbitrary value — Tailwind requires spaces to be replaced with underscores
  out.push(`shadow-[${raw.replace(/\s+/g, '_')}]`);
}

// --- Transform (decompose matrix) ---
function parseMatrix(str) {
  const m = str.match(/^matrix\(([^)]+)\)/);
  if (!m) return null;
  const [a, b, c, d, tx, ty] = m[1].split(',').map(parseFloat);
  const scaleX = Math.sqrt(a * a + b * b);
  const scaleY = Math.sqrt(c * c + d * d);
  const rotate = Math.atan2(b, a) * 180 / Math.PI;
  return { scaleX, scaleY, rotate, tx, ty };
}

function genTransform(cs, out) {
  const t = cs.getPropertyValue('transform');
  if (!t || t === 'none') return;
  const parsed = parseMatrix(t);
  if (!parsed) {
    // matrix3d or something complex — use arbitrary
    out.push(`transform-[${t.replace(/\s+/g, '_')}]`);
    return;
  }
  const { scaleX, scaleY, rotate, tx, ty } = parsed;
  const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol;

  if (!near(scaleX, 1) || !near(scaleY, 1)) {
    if (near(scaleX, scaleY)) out.push(`scale-[${scaleX.toFixed(2)}]`);
    else {
      if (!near(scaleX, 1)) out.push(`scale-x-[${scaleX.toFixed(2)}]`);
      if (!near(scaleY, 1)) out.push(`scale-y-[${scaleY.toFixed(2)}]`);
    }
  }
  if (!near(rotate, 0, 0.1)) {
    out.push(`rotate-[${rotate.toFixed(1)}deg]`);
  }
  if (!near(tx, 0, 0.5)) {
    const twX = pxToTw(`${tx}px`);
    out.push(twX && !twX.startsWith('[') ? `translate-x-${twX}` : `translate-x-[${tx}px]`);
  }
  if (!near(ty, 0, 0.5)) {
    const twY = pxToTw(`${ty}px`);
    out.push(twY && !twY.startsWith('[') ? `translate-y-${twY}` : `translate-y-[${ty}px]`);
  }
}

// --- Opacity ---
const OPACITY_TIERS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
function genOpacity(cs, out) {
  const o = cs.getPropertyValue('opacity');
  if (!o || o === '1') return;
  const pct = Math.round(parseFloat(o) * 100);
  if (OPACITY_TIERS.includes(pct)) out.push(`opacity-${pct}`);
  else out.push(`opacity-[${pct}%]`);
}

// --- Transition ---
function genTransition(cs, out) {
  const dur = cs.getPropertyValue('transition-duration');
  // No real transition if duration is 0s (or all 0s for comma-separated)
  if (!dur || dur === '0s' || /^0s(\s*,\s*0s)*$/.test(dur)) return;
  const prop = cs.getPropertyValue('transition-property');
  if (!prop || prop === 'none') return;
  const timing = cs.getPropertyValue('transition-timing-function');

  // transition-property mapping
  if (prop === 'all') out.push('transition-all');
  else if (prop === 'none') { /* skip */ }
  else if (/\bcolor\b|\bbackground-color\b|\bborder-color\b|\btext-decoration-color\b|\bfill\b|\bstroke\b/.test(prop)) out.push('transition-colors');
  else if (/\bopacity\b/.test(prop) && !prop.includes(',')) out.push('transition-opacity');
  else if (/\btransform\b/.test(prop) && !prop.includes(',')) out.push('transition-transform');
  else if (/\bshadow\b/.test(prop)) out.push('transition-shadow');
  else out.push('transition');

  // Duration
  if (dur && dur !== '0s') {
    const ms = Math.round(parseFloat(dur) * 1000);
    const durTiers = { 75: '75', 100: '100', 150: '150', 200: '200', 300: '300', 500: '500', 700: '700', 1000: '1000' };
    if (durTiers[ms]) out.push(`duration-${durTiers[ms]}`);
    else out.push(`duration-[${ms}ms]`);
  }

  // Easing
  if (timing && timing !== 'ease') {
    if (timing === 'linear') out.push('ease-linear');
    else if (timing === 'ease-in') out.push('ease-in');
    else if (timing === 'ease-out') out.push('ease-out');
    else if (timing === 'ease-in-out') out.push('ease-in-out');
    else if (timing.startsWith('cubic-bezier')) out.push(`ease-[${timing.replace(/\s+/g, '_')}]`);
  }
}

// --- Typography extras ---
function genLetterSpacing(cs, out, parentCs) {
  const ls = cs.getPropertyValue('letter-spacing');
  if (!ls || ls === 'normal') return;
  if (parentCs && parentCs.getPropertyValue('letter-spacing') === ls) return;
  const px = parseFloat(ls);
  if (Math.abs(px + 0.4) < 0.05) out.push('tracking-tighter');
  else if (Math.abs(px + 0.2) < 0.05) out.push('tracking-tight');
  else if (Math.abs(px) < 0.05) out.push('tracking-normal');
  else if (Math.abs(px - 0.2) < 0.05) out.push('tracking-wide');
  else if (Math.abs(px - 0.4) < 0.05) out.push('tracking-wider');
  else if (Math.abs(px - 1.6) < 0.05) out.push('tracking-widest');
  else out.push(`tracking-[${ls}]`);
}

function genLineHeight(cs, out, parentCs) {
  const lh = cs.getPropertyValue('line-height');
  const fs = cs.getPropertyValue('font-size');
  if (!lh || lh === 'normal') return;
  if (parentCs && parentCs.getPropertyValue('line-height') === lh && parentCs.getPropertyValue('font-size') === fs) return;
  const lhPx = parseFloat(lh);
  const fsPx = parseFloat(fs);
  if (!fsPx) { out.push(`leading-[${lh}]`); return; }
  const ratio = lhPx / fsPx;
  // Tailwind named: none=1, tight=1.25, snug=1.375, normal=1.5, relaxed=1.625, loose=2
  const tiers = [
    [1.0, 'leading-none'], [1.25, 'leading-tight'], [1.375, 'leading-snug'],
    [1.5, 'leading-normal'], [1.625, 'leading-relaxed'], [2.0, 'leading-loose']
  ];
  for (const [r, name] of tiers) {
    if (Math.abs(ratio - r) < 0.05) { out.push(name); return; }
  }
  // Or integer leading-N (e.g. leading-6 = 1.5rem = 24px)
  const twSpacing = pxToTw(lh);
  if (twSpacing && !twSpacing.startsWith('[')) { out.push(`leading-${twSpacing}`); return; }
  out.push(`leading-[${lh}]`);
}

function genFontFamily(cs, out, parentCs) {
  const ff = cs.getPropertyValue('font-family');
  if (!ff) return;
  if (parentCs && parentCs.getPropertyValue('font-family') === ff) return;
  const lower = ff.toLowerCase();
  if (lower.includes('monospace') || lower.includes('mono') || lower.includes('courier') || lower.includes('consolas')) out.push('font-mono');
  else if (lower.includes('serif') && !lower.includes('sans-serif')) out.push('font-serif');
  // 'font-sans' is the default — only emit if explicitly named AND no better match?
  // Skip emitting font-sans to reduce bloat (it's default)
}

// =============================================================================
// 4. KEYWORD MAP + BASE CLASS BUILDER
// =============================================================================

const TW_KEYWORD_MAP = {
  'display': {
    'block': 'block', 'inline-block': 'inline-block', 'inline': 'inline',
    'flex': 'flex', 'inline-flex': 'inline-flex',
    'grid': 'grid', 'inline-grid': 'inline-grid',
    'none': 'hidden', 'table': 'table', 'table-cell': 'table-cell',
    'table-row': 'table-row', 'flow-root': 'flow-root', 'contents': 'contents'
  },
  'position': { 'absolute': 'absolute', 'relative': 'relative', 'fixed': 'fixed', 'sticky': 'sticky' },
  'flex-direction': {
    'row': 'flex-row', 'row-reverse': 'flex-row-reverse',
    'column': 'flex-col', 'column-reverse': 'flex-col-reverse'
  },
  'flex-wrap': { 'wrap': 'flex-wrap', 'wrap-reverse': 'flex-wrap-reverse', 'nowrap': 'flex-nowrap' },
  'align-items': {
    'center': 'items-center', 'flex-start': 'items-start', 'flex-end': 'items-end',
    'baseline': 'items-baseline', 'stretch': 'items-stretch'
  },
  'justify-content': {
    'center': 'justify-center', 'space-between': 'justify-between',
    'space-around': 'justify-around', 'space-evenly': 'justify-evenly',
    'flex-start': 'justify-start', 'flex-end': 'justify-end'
  },
  'align-self': {
    'auto': 'self-auto', 'center': 'self-center', 'flex-start': 'self-start',
    'flex-end': 'self-end', 'stretch': 'self-stretch', 'baseline': 'self-baseline'
  },
  'align-content': {
    'center': 'content-center', 'flex-start': 'content-start', 'flex-end': 'content-end',
    'space-between': 'content-between', 'space-around': 'content-around',
    'space-evenly': 'content-evenly'
  },
  'text-align': { 'center': 'text-center', 'left': 'text-left', 'right': 'text-right', 'justify': 'text-justify' },
  // baseline = default — drop
  'vertical-align': {
    'top': 'align-top', 'middle': 'align-middle',
    'bottom': 'align-bottom', 'text-top': 'align-text-top', 'text-bottom': 'align-text-bottom'
  },
  'font-weight': {
    '100': 'font-thin', '200': 'font-extralight', '300': 'font-light',
    '400': 'font-normal', '500': 'font-medium', '600': 'font-semibold',
    '700': 'font-bold', '800': 'font-extrabold', '900': 'font-black'
  },
  'font-style': { 'italic': 'italic', 'normal': 'not-italic' },
  'text-decoration-line': { 'underline': 'underline', 'line-through': 'line-through', 'none': 'no-underline', 'overline': 'overline' },
  'text-transform': { 'uppercase': 'uppercase', 'lowercase': 'lowercase', 'capitalize': 'capitalize', 'none': 'normal-case' },
  'white-space': {
    'normal': 'whitespace-normal', 'nowrap': 'whitespace-nowrap', 'pre': 'whitespace-pre',
    'pre-wrap': 'whitespace-pre-wrap', 'pre-line': 'whitespace-pre-line', 'break-spaces': 'whitespace-break-spaces'
  },
  'word-break': { 'break-all': 'break-all', 'keep-all': 'break-keep', 'normal': 'break-normal' },
  'overflow-wrap': { 'anywhere': 'break-words', 'break-word': 'break-words' },
  'overflow': { 'hidden': 'overflow-hidden', 'auto': 'overflow-auto', 'scroll': 'overflow-scroll', 'visible': 'overflow-visible' },
  'overflow-x': { 'hidden': 'overflow-x-hidden', 'auto': 'overflow-x-auto', 'scroll': 'overflow-x-scroll', 'visible': 'overflow-x-visible' },
  'overflow-y': { 'hidden': 'overflow-y-hidden', 'auto': 'overflow-y-auto', 'scroll': 'overflow-y-scroll', 'visible': 'overflow-y-visible' },
  // fill = default — drop. <img> gets 'fill' by default which is pure noise.
  'object-fit': {
    'contain': 'object-contain', 'cover': 'object-cover',
    'none': 'object-none', 'scale-down': 'object-scale-down'
  },
  // Only non-default values — default `auto` is silently dropped to avoid bloat
  'user-select': { 'none': 'select-none', 'text': 'select-text', 'all': 'select-all' },
  'pointer-events': { 'none': 'pointer-events-none' },
  'visibility': { 'hidden': 'invisible', 'collapse': 'collapse' },
  'box-sizing': { 'border-box': 'box-border' }, // content-box is default — drop
  'list-style-type': { 'decimal': 'list-decimal', 'none': 'list-none' }, // disc = default for <ul>
  'list-style-position': { 'inside': 'list-inside' }, // outside = default
  'resize': { 'both': 'resize', 'horizontal': 'resize-x', 'vertical': 'resize-y' }, // none = default
  'cursor': {
    'pointer': 'cursor-pointer', 'not-allowed': 'cursor-not-allowed', 'wait': 'cursor-wait',
    'text': 'cursor-text', 'move': 'cursor-move', 'help': 'cursor-help',
    'grab': 'cursor-grab', 'grabbing': 'cursor-grabbing'
  }, // auto/default dropped
  'isolation': { 'isolate': 'isolate' }, // auto = default
  'mix-blend-mode': {
    'multiply': 'mix-blend-multiply', 'screen': 'mix-blend-screen', 'overlay': 'mix-blend-overlay',
    'darken': 'mix-blend-darken', 'lighten': 'mix-blend-lighten'
  }
};

// Named font-size tiers
const FONT_SIZE_MAP = {
  '12px': 'text-xs', '14px': 'text-sm', '16px': 'text-base', '18px': 'text-lg',
  '20px': 'text-xl', '24px': 'text-2xl', '30px': 'text-3xl', '36px': 'text-4xl',
  '48px': 'text-5xl', '60px': 'text-6xl', '72px': 'text-7xl', '96px': 'text-8xl', '128px': 'text-9xl'
};

const SPACING_PROPS = [
  { css: 'width', tw: 'w' }, { css: 'height', tw: 'h' },
  { css: 'min-width', tw: 'min-w' }, { css: 'min-height', tw: 'min-h' },
  { css: 'max-width', tw: 'max-w' }, { css: 'max-height', tw: 'max-h' },
  { css: 'margin-top', tw: 'mt' }, { css: 'margin-right', tw: 'mr' },
  { css: 'margin-bottom', tw: 'mb' }, { css: 'margin-left', tw: 'ml' },
  { css: 'padding-top', tw: 'pt' }, { css: 'padding-right', tw: 'pr' },
  { css: 'padding-bottom', tw: 'pb' }, { css: 'padding-left', tw: 'pl' },
  { css: 'top', tw: 'top' }, { css: 'left', tw: 'left' },
  { css: 'right', tw: 'right' }, { css: 'bottom', tw: 'bottom' },
  { css: 'gap', tw: 'gap' }, { css: 'row-gap', tw: 'gap-y' }, { css: 'column-gap', tw: 'gap-x' }
];

function genKeywords(cs, element, out, parentCs) {
  const tagName = element && element.tagName ? element.tagName.toLowerCase() : 'div';
  const isFlex = cs.display === 'flex' || cs.display === 'inline-flex';
  const parentIsFlex = parentCs && (parentCs.display === 'flex' || parentCs.display === 'inline-flex');
  const parentIsGrid = parentCs && (parentCs.display === 'grid' || parentCs.display === 'inline-grid');

  for (const [prop, map] of Object.entries(TW_KEYWORD_MAP)) {
    const val = cs.getPropertyValue(prop);
    // skip defaults / noise
    if (prop === 'display' && TAG_DEFAULT_DISPLAY[tagName] === val) continue;
    if (prop === 'position' && val === 'static') continue;
    // Flex-container props: only meaningful when the element IS a flex container
    if ((prop === 'flex-direction' || prop === 'flex-wrap' ||
         prop === 'justify-content' || prop === 'align-items') && !isFlex) continue;
    // Flex-item props: only meaningful with a flex/grid parent
    if ((prop === 'align-self') && !parentIsFlex && !parentIsGrid) continue;
    if (prop === 'flex-direction' && val === 'row') continue;
    if (prop === 'flex-wrap' && val === 'nowrap') continue;
    if (prop === 'align-items' && (val === 'normal' || val === 'stretch')) continue;
    if (prop === 'justify-content' && val === 'normal') continue;
    if (prop === 'align-self' && val === 'auto') continue;
    if (prop === 'align-content' && val === 'normal') continue;
    if (prop === 'overflow' && val === 'visible') continue;
    if (prop === 'overflow-x' && val === 'visible') continue;
    if (prop === 'overflow-y' && val === 'visible') continue;
    // Dedupe overflow longhands vs shorthand
    if ((prop === 'overflow-x' || prop === 'overflow-y') && val === cs.getPropertyValue('overflow')) continue;
    if (prop === 'visibility' && val === 'visible') continue;
    if (prop === 'text-transform' && val === 'none') continue;
    if (prop === 'text-decoration-line' && val === 'none') continue;
    if (prop === 'font-style' && val === 'normal') continue;
    if (prop === 'white-space' && val === 'normal') continue;
    if (prop === 'word-break' && val === 'normal') continue;
    if (prop === 'box-sizing' && val === 'content-box') continue;
    // box-sizing: border-box is ubiquitously set via `* { box-sizing: border-box }`
    // resets on modern sites. Emitting it on every descendant is noise — only emit
    // when it differs from the parent's computed value (which will be true only once,
    // at the reset boundary).
    if (prop === 'box-sizing' && parentCs && parentCs.getPropertyValue(prop) === val) continue;
    if (prop === 'font-weight' && val === '400' && tagName !== 'b' && tagName !== 'strong') continue;
    // Inherited text properties matching parent → skip
    if (parentCs && (prop === 'text-align' || prop === 'text-transform' ||
        prop === 'font-style' || prop === 'white-space' || prop === 'word-break' ||
        prop === 'cursor' || prop === 'visibility') &&
        parentCs.getPropertyValue(prop) === val) continue;
    if (map[val]) out.push(map[val]);
  }
}

function genSpacing(cs, element, out) {
  // gap only applies when this element is a flex/grid container. Emitting it
  // elsewhere is noise — CSS ignores it and the output bloats with `gap-[normal]`.
  const isFlexOrGrid = /^(flex|inline-flex|grid|inline-grid)$/.test(cs.display);

  // Width heuristic: skip when computed matches the viewport width (full-width
  // wrapper) OR the parent's content width (element takes full container width
  // because of auto/100%). Prevents `w-[1440px]` on sections/footers.
  let viewportWidth = 0;
  let parentContentWidth = 0;
  try {
    if (element && element.ownerDocument) {
      viewportWidth = element.ownerDocument.documentElement.clientWidth || 0;
      if (element.parentElement) parentContentWidth = element.parentElement.clientWidth || 0;
    }
  } catch (e) { }

  function isLayoutDerivedWidth(val) {
    if (!element) return false;
    // Explicit inline width → keep
    const inline = element.style && element.style.width;
    if (inline) return false;
    const px = parseFloat(val);
    if (viewportWidth && Math.abs(px - viewportWidth) < 2) return true;
    if (parentContentWidth && Math.abs(px - parentContentWidth) < 2) return true;
    return false;
  }

  for (const { css, tw } of SPACING_PROPS) {
    let val = cs.getPropertyValue(css);

    // Skip gap family on non-flex/grid
    if (/gap/.test(css) && !isFlexOrGrid) continue;
    if (/gap/.test(css) && val === 'normal') continue;

    // Percentages preserved via inline style
    if (element && element.style && element.style[css] && element.style[css].includes('%')) {
      const pct = element.style[css];
      const fractions = { '50%': '1/2', '33.33%': '1/3', '66.66%': '2/3', '25%': '1/4', '75%': '3/4', '100%': 'full' };
      out.push(`${tw}-${fractions[pct] || `[${pct}]`}`);
      continue;
    }
    if (!val || val === 'auto' || val === '0px' || val === 'none') continue;

    // Viewport-width filter — only for explicit `width`, not min/max
    if (css === 'width' && isLayoutDerivedWidth(val)) continue;

    const twVal = pxToTw(val);
    if (!twVal) continue;
    // Tailwind's negative modifier goes in FRONT of the property: `-bottom-[120px]`,
    // not `bottom--[120px]`. pxToTw returns values prefixed with `-` for negatives.
    if (twVal.startsWith('-')) out.push(`-${tw}-${twVal.slice(1)}`);
    else out.push(`${tw}-${twVal}`);
  }

  // z-index
  const z = cs.getPropertyValue('z-index');
  if (z && z !== 'auto') {
    const zi = parseInt(z);
    if (zi >= 0 && zi <= 50 && zi % 10 === 0) out.push(`z-${zi}`);
    else out.push(`z-[${z}]`);
  }
}

function genFontSize(cs, out, parentCs) {
  const fs = cs.getPropertyValue('font-size');
  if (!fs) return;
  if (parentCs && parentCs.getPropertyValue('font-size') === fs) return; // inherited
  if (FONT_SIZE_MAP[fs]) { out.push(FONT_SIZE_MAP[fs]); return; }
  out.push(`text-[${fs}]`);
}

// --- Linear gradient → bg-gradient-to-* emitter ------------------------------
// When the computed background-image is a simple linear-gradient with 2–3 stops
// and a cardinal/diagonal angle, emit idiomatic `bg-gradient-to-r from-X to-Y`.
// Otherwise, fall back to the arbitrary-value form.

// CSS gradient angle (CSS treats 0deg as "going up") → Tailwind direction suffix.
// Keyword forms (`to top`, `to top right`, …) are normalized below.
const GRADIENT_ANGLE_MAP = {
  '0deg':   't', '0':    't',
  '45deg':  'tr',
  '90deg':  'r',
  '135deg': 'br',
  '180deg': 'b',
  '225deg': 'bl',
  '270deg': 'l',
  '315deg': 'tl',
  '360deg': 't',
  'to top':          't',
  'to top right':    'tr', 'to right top':    'tr',
  'to right':        'r',
  'to bottom right': 'br', 'to right bottom': 'br',
  'to bottom':       'b',
  'to bottom left':  'bl', 'to left bottom':  'bl',
  'to left':         'l',
  'to top left':     'tl', 'to left top':     'tl'
};

// Split a comma-separated list while respecting parentheses (so rgba(x,y,z) stays intact).
function splitByTopLevelComma(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

// Extract the color + optional position from a gradient stop.
// "red 20%", "rgba(0,0,0,0.5) 50%", "#fff" → { color, position }
function parseGradientStop(stop) {
  // Find last whitespace that isn't inside a function call
  let depth = 0, splitAt = -1;
  for (let i = 0; i < stop.length; i++) {
    if (stop[i] === '(') depth++;
    else if (stop[i] === ')') depth--;
    else if (stop[i] === ' ' && depth === 0) splitAt = i;
  }
  if (splitAt < 0) return { color: stop, position: null };
  const left = stop.slice(0, splitAt).trim();
  const right = stop.slice(splitAt).trim();
  // If the "right" bit looks like a position (percent / px / length), split.
  if (/^-?\d+(\.\d+)?(%|px|rem|em)?$/.test(right)) {
    return { color: left, position: right };
  }
  return { color: stop, position: null };
}

// Returns { dir, stops } on success, or null to signal "fall back to arbitrary".
function parseLinearGradient(value) {
  const m = value.match(/^linear-gradient\(([\s\S]+)\)$/);
  if (!m) return null;

  const parts = splitByTopLevelComma(m[1]);
  if (parts.length < 2) return null;

  let dirText = parts[0];
  let stops;
  // If the first segment looks like a direction (`to …` or `<angle>deg`), consume it.
  // Otherwise it's the first color stop and the angle defaults to `to bottom` (180deg).
  if (/^to\s/.test(dirText) || /(deg|turn|rad|grad)$/.test(dirText) || dirText === '0') {
    stops = parts.slice(1);
  } else {
    dirText = '180deg';
    stops = parts;
  }
  // Normalize `0.5turn` → 180deg etc. Only support degrees for mapping.
  let dirKey = dirText.trim().toLowerCase().replace(/\s+/g, ' ');
  if (dirKey.endsWith('turn')) dirKey = `${parseFloat(dirKey) * 360}deg`;
  if (dirKey.endsWith('rad'))  dirKey = `${Math.round(parseFloat(dirKey) * 180 / Math.PI)}deg`;
  if (dirKey.endsWith('grad')) dirKey = `${Math.round(parseFloat(dirKey) * 0.9)}deg`;

  const dir = GRADIENT_ANGLE_MAP[dirKey];
  if (!dir) return null;
  if (stops.length < 2 || stops.length > 3) return null;

  const parsedStops = stops.map(parseGradientStop);

  // If positions are present, require them to be the "canonical" distribution
  // (0% / 50% / 100%). Anything else — fall back to arbitrary so we don't lie.
  const positioned = parsedStops.filter(s => s.position !== null);
  if (positioned.length > 0 && positioned.length !== parsedStops.length) return null;
  if (positioned.length === parsedStops.length) {
    const expected = parsedStops.length === 2 ? ['0%', '100%'] : ['0%', '50%', '100%'];
    if (!parsedStops.every((s, i) => s.position === expected[i])) return null;
  }

  return { dir, stops: parsedStops.map(s => s.color) };
}

// Map a single parsed color (string) to a Tailwind `from-…` / `to-…` suffix.
// Uses normalizeColor so palette matching + arbitrary fallback both work.
function gradientColorToken(color) {
  const t = normalizeColor(color);
  return t || `[${color.trim().replace(/\s+/g, '_')}]`;
}

function emitGradient(bgImg, out) {
  // Only simple single gradients — bail on stacks (`linear-gradient(…), linear-gradient(…)`)
  // and on radial/conic which Tailwind doesn't map cleanly.
  if (/,\s*(linear|radial|conic)-gradient/i.test(bgImg)) return false;
  if (/radial-gradient|conic-gradient/i.test(bgImg)) return false;

  const parsed = parseLinearGradient(bgImg);
  if (!parsed) return false;

  const { dir, stops } = parsed;
  out.push(`bg-gradient-to-${dir}`);
  out.push(`from-${gradientColorToken(stops[0])}`);
  if (stops.length === 3) out.push(`via-${gradientColorToken(stops[1])}`);
  out.push(`to-${gradientColorToken(stops[stops.length - 1])}`);
  return true;
}

function genColors(cs, out, parentCs) {
  const bg = normalizeColor(cs.getPropertyValue('background-color'));
  if (bg) out.push(`bg-${bg}`);

  const bgImg = cs.getPropertyValue('background-image');
  if (bgImg && bgImg !== 'none' && bgImg.includes('gradient')) {
    if (!emitGradient(bgImg, out)) {
      // Complex gradient → arbitrary fallback, spaces as underscores for Tailwind JIT.
      out.push(`bg-[${bgImg.replace(/\s+/g, '_')}]`);
    }
  }

  const colRaw = cs.getPropertyValue('color');
  if (parentCs && parentCs.getPropertyValue('color') === colRaw) return; // inherited
  const col = normalizeColor(colRaw);
  if (col) out.push(`text-${col}`);
}

// Tailwind v4 renamed a handful of default tiers. When the user flips the
// version toggle in options, we run the output through this one-pass rename
// map so their copies land as idiomatic v4 class names.
//   v3            →  v4
//   shadow-sm         shadow-xs
//   shadow            shadow-sm
//   rounded-sm        rounded-xs
//   rounded           rounded-sm
//   blur-sm           blur-xs
//   blur              blur-sm
//   drop-shadow-sm    drop-shadow-xs
//   drop-shadow       drop-shadow-sm
//   bg-gradient-to-*  bg-linear-to-*
//   outline-none      outline-hidden
// Lookup is by EXACT string so cascading rewrites (shadow-sm → shadow-xs and
// shadow → shadow-sm) don't chain — each class is transformed once.
const V4_RENAMES = {
  'shadow-sm': 'shadow-xs',
  'shadow': 'shadow-sm',
  'rounded-sm': 'rounded-xs',
  'rounded': 'rounded-sm',
  'blur-sm': 'blur-xs',
  'blur': 'blur-sm',
  'drop-shadow-sm': 'drop-shadow-xs',
  'drop-shadow': 'drop-shadow-sm',
  'bg-gradient-to-t': 'bg-linear-to-t',
  'bg-gradient-to-tr': 'bg-linear-to-tr',
  'bg-gradient-to-r': 'bg-linear-to-r',
  'bg-gradient-to-br': 'bg-linear-to-br',
  'bg-gradient-to-b': 'bg-linear-to-b',
  'bg-gradient-to-bl': 'bg-linear-to-bl',
  'bg-gradient-to-l': 'bg-linear-to-l',
  'bg-gradient-to-tl': 'bg-linear-to-tl',
  'outline-none': 'outline-hidden',
  'ring': 'ring-3'
};

let TW_VERSION = 'v3';
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  try {
    chrome.storage.local.get({ twVersion: 'v3' }, (r) => { TW_VERSION = r.twVersion || 'v3'; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.twVersion) TW_VERSION = changes.twVersion.newValue || 'v3';
    });
  } catch (e) { /* tests */ }
}

function applyTwVersionRenames(classes) {
  if (TW_VERSION !== 'v4') return classes;
  return classes.map(c => V4_RENAMES[c] || c);
}

function generateTailwindClasses(computed, element, parentComputed) {
  // SVG child elements are styled via SVG attrs (fill, stroke, etc.) — skip.
  const tagUpper = element && element.tagName ? element.tagName.toUpperCase() : '';
  if (SVG_CHILD_TAGS && SVG_CHILD_TAGS.has(tagUpper)) return '';

  const out = [];
  genKeywords(computed, element, out, parentComputed);
  genSpacing(computed, element, out);
  genFontSize(computed, out, parentComputed);
  genColors(computed, out, parentComputed);
  genBorders(computed, out);
  genShadow(computed, out);
  genTransform(computed, out);
  genOpacity(computed, out);
  genTransition(computed, out);
  genLetterSpacing(computed, out, parentComputed);
  genLineHeight(computed, out, parentComputed);
  genFontFamily(computed, out, parentComputed);
  return applyTwVersionRenames(out).join(' ');
}

// =============================================================================
// 5. INLINE STYLE EMITTER
// =============================================================================

const INLINE_STYLE_PROPS = [
  'display', 'position', 'top', 'left', 'right', 'bottom', 'z-index',
  'overflow', 'overflow-x', 'overflow-y',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap',
  'flex-grow', 'flex-shrink', 'flex-basis',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'line-height', 'text-align',
  'color', 'text-decoration', 'text-transform', 'letter-spacing',
  'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'box-shadow', 'opacity', 'visibility',
  'transform', 'transform-origin', 'transition', 'cursor', 'object-fit', 'pointer-events'
];

// Per-tag default display. Used to skip emitting a display utility/style when
// it matches the tag's spec default (`table` on <table>, `list-item` on <li>...).
const TAG_DEFAULT_DISPLAY = {
  'div': 'block', 'section': 'block', 'article': 'block', 'main': 'block',
  'aside': 'block', 'header': 'block', 'footer': 'block', 'nav': 'block',
  'p': 'block', 'h1': 'block', 'h2': 'block', 'h3': 'block', 'h4': 'block',
  'h5': 'block', 'h6': 'block', 'ul': 'block', 'ol': 'block', 'dl': 'block',
  'form': 'block', 'figure': 'block', 'blockquote': 'block', 'pre': 'block',
  'hr': 'block', 'address': 'block', 'fieldset': 'block', 'legend': 'block',
  'span': 'inline', 'a': 'inline', 'em': 'inline', 'strong': 'inline',
  'small': 'inline', 'b': 'inline', 'i': 'inline', 'code': 'inline',
  'mark': 'inline', 'sub': 'inline', 'sup': 'inline', 'u': 'inline',
  'abbr': 'inline', 'cite': 'inline', 'kbd': 'inline', 'q': 'inline',
  's': 'inline', 'var': 'inline', 'time': 'inline', 'br': 'inline',
  'table': 'table', 'thead': 'table-header-group', 'tbody': 'table-row-group',
  'tfoot': 'table-footer-group', 'tr': 'table-row',
  'td': 'table-cell', 'th': 'table-cell', 'caption': 'table-caption',
  'colgroup': 'table-column-group', 'col': 'table-column',
  'li': 'list-item', 'summary': 'list-item',
  'img': 'inline', 'input': 'inline-block', 'button': 'inline-block',
  'select': 'inline-block', 'textarea': 'inline-block', 'label': 'inline',
  'svg': 'inline-block'
};

// Inline-style emitter defaults. Values that equal the CSS spec default.
const INLINE_DEFAULTS = {
  'position': ['static'],
  'top': ['auto'], 'left': ['auto'], 'right': ['auto'], 'bottom': ['auto'],
  'z-index': ['auto'],
  'overflow': ['visible'], 'overflow-x': ['visible'], 'overflow-y': ['visible'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  'justify-content': ['normal'],
  'align-items': ['normal', 'stretch'],
  'align-self': ['auto', 'normal', 'stretch'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  'gap': ['normal', '0px'],
  'margin-top': ['0px'], 'margin-right': ['0px'], 'margin-bottom': ['0px'], 'margin-left': ['0px'],
  'padding-top': ['0px'], 'padding-right': ['0px'], 'padding-bottom': ['0px'], 'padding-left': ['0px'],
  'min-width': ['auto', '0px'], 'min-height': ['auto', '0px'],
  'max-width': ['none'], 'max-height': ['none'],
  'width': ['auto'], 'height': ['auto'],
  'text-align': ['start'],
  'text-decoration': ['none', 'none solid rgb(0, 0, 0)'],
  'text-transform': ['none'],
  'letter-spacing': ['normal'],
  'line-height': ['normal'],
  'font-style': ['normal'],
  'font-weight': ['400', 'normal'],
  'white-space': ['normal'],
  'color': ['rgb(0, 0, 0)'],
  'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
  'background-image': ['none'],
  'background-position': ['0% 0%'],
  'background-size': ['auto', 'auto auto'],
  'background-repeat': ['repeat'],
  'border-top-width': ['0px'], 'border-right-width': ['0px'],
  'border-bottom-width': ['0px'], 'border-left-width': ['0px'],
  'border-top-style': ['none'], 'border-right-style': ['none'],
  'border-bottom-style': ['none'], 'border-left-style': ['none'],
  'border-radius': ['0px'],
  'box-shadow': ['none'],
  'opacity': ['1'],
  'visibility': ['visible'],
  'transform': ['none'],
  'transform-origin': ['50% 50%', '50% 50% 0px'],
  'cursor': ['auto', 'default'],
  'object-fit': ['fill'],
  'pointer-events': ['auto']
};

// Properties that inherit by default. If parent has the same value, the child
// doesn't need to re-declare it.
const INHERITED_PROPS = new Set([
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'text-decoration', 'white-space', 'word-break', 'cursor', 'visibility'
]);

// SVG child elements only accept SVG-specific attrs for most styling.
// Most CSS layout properties are meaningless on <path>/<circle>/<line> etc.
const SVG_CHILD_TAGS = new Set([
  'PATH', 'CIRCLE', 'ELLIPSE', 'LINE', 'POLYLINE', 'POLYGON', 'RECT',
  'TEXT', 'TSPAN', 'G', 'USE', 'DEFS', 'MASK', 'CLIPPATH', 'FILTER',
  'LINEARGRADIENT', 'RADIALGRADIENT', 'STOP', 'SYMBOL', 'MARKER',
  'PATTERN', 'IMAGE', 'FOREIGNOBJECT', 'SWITCH', 'VIEW', 'METADATA', 'TITLE', 'DESC'
]);

function generateInlineStyles(cs, element, parentCs) {
  const isFlexContainer = cs.display === 'flex' || cs.display === 'inline-flex';
  const isGridContainer = cs.display === 'grid' || cs.display === 'inline-grid';
  const parentIsFlex = parentCs && (parentCs.display === 'flex' || parentCs.display === 'inline-flex');
  const parentIsGrid = parentCs && (parentCs.display === 'grid' || parentCs.display === 'inline-grid');
  const hasBg = cs.getPropertyValue('background-image') !== 'none' ||
                cs.getPropertyValue('background-color') !== 'rgba(0, 0, 0, 0)';
  const tagUpper = element && element.tagName ? element.tagName.toUpperCase() : '';
  const isSvgChild = SVG_CHILD_TAGS.has(tagUpper);

  // SVG children get essentially no inline styles — SVG uses its own attrs.
  // Exception: the <svg> root itself still benefits from layout styles.
  if (isSvgChild) return '';

  const transitionDur = cs.getPropertyValue('transition-duration');
  const hasRealTransition = transitionDur && transitionDur !== '0s' &&
                            !/^0s(, 0s)*$/.test(transitionDur);

  let s = '';
  const overflowVal = cs.getPropertyValue('overflow');
  const tagLower = element && element.tagName ? element.tagName.toLowerCase() : '';
  let viewportWidth = 0;
  try { viewportWidth = element && element.ownerDocument ? element.ownerDocument.documentElement.clientWidth : 0; } catch (e) { }

  for (const p of INLINE_STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (!v) continue;

    // Display: skip if it matches the tag's spec default
    if (p === 'display' && TAG_DEFAULT_DISPLAY[tagLower] === v) continue;

    // Generic default-noise filter
    if (INLINE_DEFAULTS[p] && INLINE_DEFAULTS[p].includes(v)) continue;

    // Viewport-width filter for explicit `width` — only when not set inline
    if (p === 'width' && viewportWidth > 0) {
      const inline = element && element.style && element.style.width;
      if (!inline && Math.abs(parseFloat(v) - viewportWidth) < 2) continue;
    }

    // Context-specific skips
    if ((p === 'flex-direction' || p === 'flex-wrap' || p === 'justify-content' ||
         p === 'align-items' || p === 'gap') && !isFlexContainer && !isGridContainer) continue;
    if ((p === 'flex-grow' || p === 'flex-shrink' || p === 'flex-basis' ||
         p === 'align-self') && !parentIsFlex && !parentIsGrid) continue;
    if (p.startsWith('grid-') && !isGridContainer && !parentIsGrid) continue;

    // Borders: skip style/color when that side has no width
    const borderSideMatch = p.match(/^border-(top|right|bottom|left)-(style|color)$/);
    if (borderSideMatch) {
      const width = cs.getPropertyValue(`border-${borderSideMatch[1]}-width`);
      if (!width || width === '0px') continue;
    }

    // Background position/size/repeat only meaningful with an image
    if ((p === 'background-position' || p === 'background-size' || p === 'background-repeat')
        && cs.getPropertyValue('background-image') === 'none') continue;

    // Dedupe overflow longhands when they equal overflow shorthand
    if ((p === 'overflow-x' || p === 'overflow-y') && v === overflowVal) continue;

    // Transition shorthand is noise if there's no actual duration
    if (p === 'transition' && !hasRealTransition) continue;

    // Inherited property equal to parent → redundant
    if (INHERITED_PROPS.has(p) && parentCs && parentCs.getPropertyValue(p) === v) continue;

    s += `${p}: ${v}; `;
  }
  return s.trim();
}

// =============================================================================
// 6. STYLESHEET SCANNER — variants (hover/focus/active/responsive) + keyframes
// =============================================================================

// Maps raw pseudo-class name → Tailwind variant prefix
const PSEUDO_VARIANT_MAP = {
  'hover': 'hover',
  'focus': 'focus',
  'focus-visible': 'focus-visible',
  'focus-within': 'focus-within',
  'active': 'active',
  'disabled': 'disabled',
  'checked': 'checked',
  'visited': 'visited',
  'placeholder-shown': 'placeholder-shown',
  'first-child': 'first',
  'last-child': 'last',
  'only-child': 'only',
  'odd': 'odd',
  'even': 'even',
  'empty': 'empty',
  'required': 'required',
  'optional': 'optional',
  'read-only': 'read-only',
  'invalid': 'invalid'
};

// Maps @media (min-width: N) → Tailwind breakpoint prefix
// Map a media query's `mediaText` to a Tailwind variant prefix chain.
// Supports: min-width breakpoints (sm/md/lg/xl/2xl), prefers-color-scheme,
// prefers-reduced-motion, print, and orientation. Composes when multiple
// conditions are present, e.g. `(min-width: 768px) and (prefers-color-scheme: dark)`
// → `md:dark:`.
function mediaToPrefix(mediaText) {
  let prefix = '';

  const widthMatch = mediaText.match(/min-width:\s*(\d+)px/);
  if (widthMatch) {
    const px = parseInt(widthMatch[1]);
    if (px === 640) prefix += 'sm:';
    else if (px === 768) prefix += 'md:';
    else if (px === 1024) prefix += 'lg:';
    else if (px === 1280) prefix += 'xl:';
    else if (px === 1536) prefix += '2xl:';
    else prefix += `min-[${px}px]:`;
  }

  if (/prefers-color-scheme:\s*dark/.test(mediaText)) prefix += 'dark:';
  if (/prefers-reduced-motion:\s*reduce/.test(mediaText)) prefix += 'motion-reduce:';
  if (/prefers-reduced-motion:\s*no-preference/.test(mediaText)) prefix += 'motion-safe:';
  if (/\bprint\b/.test(mediaText) && !/\bscreen\b/.test(mediaText)) prefix += 'print:';
  if (/orientation:\s*portrait/.test(mediaText)) prefix += 'portrait:';
  if (/orientation:\s*landscape/.test(mediaText)) prefix += 'landscape:';

  // If we couldn't understand anything but the query exists, return '' so the
  // rules under it are treated as base (better than dropping them).
  return prefix;
}

// Walks all stylesheets once, returns a flat array of rule descriptors.
// [{selector, baseSelector, statePrefix, mediaPrefix, style (CSSStyleDeclaration)}]
function buildRuleCache() {
  const cache = [];
  const keyframes = {};
  const fontFaces = []; // @font-face rule cssText, keyed by family name later

  const walk = (rules, mediaPrefix) => {
    for (const rule of rules) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const selectors = rule.selectorText.split(',').map(s => s.trim());
        for (const sel of selectors) {
          const { baseSelector, statePrefix } = splitSelectorState(sel);
          if (!baseSelector) continue;
          cache.push({ selector: sel, baseSelector, statePrefix, mediaPrefix, style: rule.style });
        }
      } else if (rule.type === CSSRule.MEDIA_RULE) {
        const mp = mediaToPrefix(rule.media.mediaText);
        if (mp !== null) walk(rule.cssRules, mediaPrefix + mp);
      } else if (rule.type === CSSRule.SUPPORTS_RULE) {
        walk(rule.cssRules, mediaPrefix);
      } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
        keyframes[rule.name] = rule.cssText;
      } else if (rule.type === CSSRule.FONT_FACE_RULE) {
        // Keep the whole @font-face rule text — includes src: url(...) etc.
        // Extract the font-family so we can only emit the ones the capture uses.
        const familyMatch = rule.cssText.match(/font-family:\s*(['"]?)([^;'"]+)\1/i);
        fontFaces.push({
          family: familyMatch ? familyMatch[2].trim() : null,
          cssText: rule.cssText
        });
      }
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, '');
    } catch (e) {
      // CORS-blocked stylesheet
    }
  }

  return { rules: cache, keyframes, fontFaces };
}

// Split "a.btn:hover::before" → { baseSelector: "a.btn", statePrefix: "hover:" }
// We strip ONE recognized state pseudo-class. Pseudo-elements (::before) are kept in base.
function splitSelectorState(sel) {
  // Don't try to handle :not(), :has(), compound pseudo-classes — skip them
  if (/:not\(|:has\(|:is\(|:where\(/.test(sel)) return { baseSelector: null, statePrefix: '' };

  // Find last supported pseudo-class (single colon, not ::)
  const pseudoRegex = /(?<!:):([a-z-]+)(?![a-z-])/gi;
  let match;
  let lastMatch = null;
  while ((match = pseudoRegex.exec(sel)) !== null) {
    if (PSEUDO_VARIANT_MAP[match[1]]) lastMatch = { name: match[1], idx: match.index, full: match[0] };
  }

  if (!lastMatch) return { baseSelector: sel, statePrefix: '' };

  // Remove the pseudo from the selector
  const base = sel.slice(0, lastMatch.idx) + sel.slice(lastMatch.idx + lastMatch.full.length);
  return { baseSelector: base || '*', statePrefix: `${PSEUDO_VARIANT_MAP[lastMatch.name]}:` };
}

// Convert a (sparse) CSSStyleDeclaration from a rule into TW classes.
// Rules only contain explicitly-set properties, so we iterate `.length`.
function ruleStyleToClasses(style, syntheticEl) {
  const out = [];
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    const val = style.getPropertyValue(prop);
    singlePropToClasses(prop, val, out, syntheticEl);
  }
  return out;
}

// Emit Tailwind for a single (prop, value) pair. This is the shared dispatcher
// used by both rule-style → variant conversion and base conversion.
function singlePropToClasses(prop, val, out, syntheticEl) {
  if (!val || val === '' || val === 'auto' || val === 'initial' || val === 'inherit' || val === 'unset') return;

  // Keyword properties
  if (TW_KEYWORD_MAP[prop] && TW_KEYWORD_MAP[prop][val]) {
    out.push(TW_KEYWORD_MAP[prop][val]);
    return;
  }

  // Spacing family
  const spacing = SPACING_PROPS.find(p => p.css === prop);
  if (spacing) {
    const tw = pxToTw(val);
    if (tw) out.push(`${spacing.tw}-${tw}`);
    return;
  }

  // Targeted dispatches
  if (prop === 'background-color') { const c = normalizeColor(val); if (c) out.push(`bg-${c}`); return; }
  if (prop === 'color') { const c = normalizeColor(val); if (c) out.push(`text-${c}`); return; }
  if (prop === 'border-color') { const c = normalizeColor(val); if (c) out.push(`border-${c}`); return; }
  if (prop === 'opacity') {
    const pct = Math.round(parseFloat(val) * 100);
    if (OPACITY_TIERS.includes(pct)) out.push(`opacity-${pct}`);
    else out.push(`opacity-[${pct}%]`);
    return;
  }
  if (prop === 'border-radius') { const r = radiusToTw(val); if (r) out.push(r); return; }
  if (prop === 'font-size') {
    if (FONT_SIZE_MAP[val]) out.push(FONT_SIZE_MAP[val]);
    else out.push(`text-[${val}]`);
    return;
  }
  if (prop === 'transform') {
    const parsed = parseMatrix(val);
    if (parsed) {
      // Emit transform decomposed. Use the existing helper via a synthetic `cs`.
      const fakeCs = { getPropertyValue: k => k === 'transform' ? val : '' };
      genTransform(fakeCs, out);
    } else {
      out.push(`transform-[${val.replace(/\s+/g, '_')}]`);
    }
    return;
  }
  if (prop === 'box-shadow') {
    const normalized = val.replace(/\s+/g, ' ').trim();
    if (SHADOW_NAMED[normalized]) out.push(SHADOW_NAMED[normalized]);
    else out.push(`shadow-[${val.replace(/\s+/g, '_')}]`);
    return;
  }
  if (prop === 'z-index') {
    const zi = parseInt(val);
    if (!isNaN(zi) && zi >= 0 && zi <= 50 && zi % 10 === 0) out.push(`z-${zi}`);
    else out.push(`z-[${val}]`);
    return;
  }
  // Fallthrough: unknown prop, skip (don't emit garbage)
}

// For a given element, extract all variant classes (hover:, focus:, md:, etc.)
// based on stylesheet rules that match it.
function extractVariants(element, ruleCache) {
  const variantClasses = new Set();
  for (const r of ruleCache.rules) {
    if (!r.statePrefix && !r.mediaPrefix) continue; // base handled elsewhere
    let matches = false;
    try {
      matches = element.matches(r.baseSelector);
    } catch (e) { continue; }
    if (!matches) continue;

    const classes = ruleStyleToClasses(r.style, element);
    const prefix = r.mediaPrefix + r.statePrefix;
    for (const c of classes) variantClasses.add(prefix + c);
  }
  return Array.from(variantClasses).join(' ');
}

// Recover @keyframes used by this element (or any descendant with animation-name)
function collectKeyframes(cs, keyframesMap, accumulator) {
  const anim = cs.getPropertyValue('animation-name');
  if (!anim || anim === 'none') return;
  for (const name of anim.split(',').map(s => s.trim())) {
    if (keyframesMap[name] && !accumulator[name]) accumulator[name] = keyframesMap[name];
  }
}

// =============================================================================
// 7. PSEUDO-ELEMENT CAPTURE (::before / ::after)
// =============================================================================

const PSEUDO_PROPS = [
  'content', 'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'background-color', 'background-image',
  'background-size', 'background-position', 'background-repeat',
  'color', 'font-size', 'font-weight', 'line-height', 'font-family',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius',
  'box-shadow', 'transform', 'transform-origin', 'opacity', 'z-index',
  'text-align', 'text-transform', 'letter-spacing'
];

// Walk up the captured element's ancestor chain to collect context styles —
// the ones that "cascade" visually but live on a parent we're NOT capturing.
// Without this, components like Discord's dark-bg header appear on white
// when reproduced standalone, because the dark bg lives on <body>/<main>.
//
// Returns:
//   {
//     pageBg:     first opaque background we hit walking up (color or image)
//     color:      first inherited text color
//     fontFamily: first inherited font family
//     parentLayout: { display, flex/grid props, width } when parent is flex/grid
//   }
// Called at freeze time, before the walk — uses a passed getComputedStyle fn so
// iframe-interior elements resolve against their own defaultView.
function captureAncestorContext(element, getCs) {
  if (!element || !element.parentElement) return null;
  const ctx = {};

  // Immediate parent layout — if flex/grid, the captured element renders
  // according to its parent's rules (main-axis direction, gap, wrap). Without
  // replicating that in the copy, flex children collapse or stack wrong.
  const parent = element.parentElement;
  const pcs = getCs(parent);
  if (/^(flex|inline-flex|grid|inline-grid)$/.test(pcs.display)) {
    ctx.parentLayout = {
      display: pcs.display,
      flexDirection: pcs.flexDirection,
      flexWrap: pcs.flexWrap,
      justifyContent: pcs.justifyContent,
      alignItems: pcs.alignItems,
      gap: pcs.gap,
      gridTemplateColumns: pcs.gridTemplateColumns,
      gridTemplateRows: pcs.gridTemplateRows,
      // Width matters so flex/grid math has something to distribute
      width: pcs.width
    };
  }

  // Page-level visual context: bg (color + image), font-family, color.
  // Walk from element's parent up toward documentElement, stopping at first
  // non-transparent bg. Fonts + color: first non-inherited values.
  let walker = parent;
  while (walker && walker !== document.documentElement) {
    const wcs = getCs(walker);
    if (!ctx.pageBg) {
      const bgImg = wcs.backgroundImage;
      const bgCol = wcs.backgroundColor;
      const hasImg = bgImg && bgImg !== 'none';
      const hasCol = bgCol && bgCol !== 'rgba(0, 0, 0, 0)' && bgCol !== 'transparent';
      if (hasImg && hasCol) ctx.pageBg = `${bgImg}, ${bgCol}`;
      else if (hasImg) ctx.pageBg = bgImg;
      else if (hasCol) ctx.pageBg = bgCol;
    }
    if (!ctx.color) ctx.color = wcs.color;
    if (!ctx.fontFamily) ctx.fontFamily = wcs.fontFamily;
    walker = walker.parentElement;
  }
  return ctx;
}

function capturePseudos(element) {
  let cssText = '';
  let emitted = false;
  const marker = `ed-p-${++pseudoIdCounter}`;

  for (const pseudo of ['::before', '::after']) {
    const ps = window.getComputedStyle(element, pseudo);
    const content = ps.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') continue;

    const decls = [];
    for (const p of PSEUDO_PROPS) {
      const v = ps.getPropertyValue(p);
      if (!v || v === 'auto' || v === 'none' || v === 'normal' ||
          v === '0px' || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' ||
          v === 'static' || v === 'visible') continue;
      decls.push(`${p}: ${v}`);
    }
    if (decls.length === 0) continue;
    cssText += `.${marker}${pseudo} { ${decls.join('; ')} }\n`;
    emitted = true;
  }

  return emitted ? { className: marker, cssText } : null;
}

// =============================================================================
// 8. LOTTIE DETECTION
// =============================================================================

function detectLottie(element) {
  const hasLottieId = element.querySelector('[id*="__lottie_element"]') !== null;
  const hasLottiePlayer = element.querySelector('lottie-player, dotlottie-player') !== null;
  const hasSvgMasks = element.querySelectorAll('svg mask').length > 3;
  const hasBodymovinClass = element.querySelector('[class*="bodymovin"]') !== null;
  return hasLottieId || hasLottiePlayer || hasSvgMasks || hasBodymovinClass;
}

function extractLottieData() {
  const lottieData = [];
  if (typeof window.lottie !== 'undefined') {
    try {
      const animations = window.lottie.getRegisteredAnimations?.() || [];
      animations.forEach((anim, i) => {
        if (anim.animationData) {
          lottieData.push({ index: i, data: JSON.stringify(anim.animationData).substring(0, 50000) });
        }
      });
    } catch (e) { }
  }
  if (typeof window.bodymovin !== 'undefined') {
    try {
      const animations = window.bodymovin.getRegisteredAnimations?.() || [];
      animations.forEach((anim, i) => {
        if (anim.animationData) {
          lottieData.push({ index: i, data: JSON.stringify(anim.animationData).substring(0, 50000) });
        }
      });
    } catch (e) { }
  }
  return lottieData;
}

// =============================================================================
// 9. CLONER / FREEZER
// =============================================================================

// Returns { clone, extraCss, metadata }
// Pass a pre-built ruleCache when freezing many elements in one session
// (e.g. scrapePage) to avoid re-walking stylesheets per element.
function freezeElement(originalEl, ruleCacheIn) {
  if (originalEl.checkVisibility && !originalEl.checkVisibility()) return null;
  if (['SCRIPT', 'NOSCRIPT', 'STYLE'].includes(originalEl.tagName)) return null;

  const ruleCache = ruleCacheIn || buildRuleCache();
  const keyframesUsed = {};
  const pseudoCss = [];
  const shadowCss = []; // CSS from shadow roots / iframe docs — inlined so clone works standalone
  const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT']);

  // Per-freeze computed-style cache. Use the element's OWN document.defaultView
  // so elements inside same-origin iframes resolve their styles correctly.
  const csCache = new Map();
  function cs(el) {
    let v = csCache.get(el);
    if (!v) {
      const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      v = view.getComputedStyle(el);
      csCache.set(el, v);
    }
    return v;
  }

  // Recursive walker. Builds the clone tree in parallel with the original,
  // descending into shadow DOM (inlining shadow children as light DOM children
  // of the clone, since the clone has no shadow root) and same-origin iframes.
  function processElement(orig, parentComputed) {
    if (!orig || !orig.tagName) return null;
    if (SKIP_TAGS.has(orig.tagName)) return null;
    // Allow <style> for text preservation? Drop; we capture extraCss separately.
    if (orig.tagName === 'STYLE') return null;

    // --- iframe handling ----------------------------------------------------
    // Same-origin iframes: inline their body into a placeholder div, harvest
    // their stylesheets into shadowCss so styling travels.
    // Cross-origin: emit a visible skipped-iframe note.
    if (orig.tagName === 'IFRAME') {
      const src = orig.src || orig.getAttribute('src') || '';
      let innerDoc = null;
      try { innerDoc = orig.contentDocument; } catch (e) { /* cross-origin */ }

      if (innerDoc && innerDoc.body) {
        const placeholder = orig.ownerDocument.createElement('div');
        placeholder.setAttribute('data-iframe-inlined', src || 'about:blank');
        // Harvest iframe stylesheets so rules travel with the component
        try {
          for (const sheet of innerDoc.styleSheets) {
            try {
              for (const rule of sheet.cssRules) shadowCss.push(rule.cssText);
            } catch (e) { /* CORS on stylesheet */ }
          }
        } catch (e) { }
        for (const child of innerDoc.body.childNodes) {
          appendChildNode(child, placeholder, null);
        }
        return placeholder;
      }

      // Cross-origin / inaccessible iframe — friendly placeholder
      const rect = orig.getBoundingClientRect ? orig.getBoundingClientRect() : { width: 400, height: 200 };
      const note = orig.ownerDocument.createElement('div');
      note.setAttribute('data-iframe-skipped', 'cross-origin');
      note.textContent = `iframe skipped (cross-origin): ${src || 'unknown src'}`;
      note.style.cssText = [
        `width:${Math.round(rect.width) || 400}px`,
        `height:${Math.round(rect.height) || 200}px`,
        'display:flex', 'align-items:center', 'justify-content:center',
        'padding:16px', 'box-sizing:border-box',
        'border:1px dashed #9ca3af', 'border-radius:4px',
        'background:rgba(156,163,175,0.08)', 'color:#6b7280',
        'font:12px ui-sans-serif,system-ui,sans-serif', 'text-align:center'
      ].join(';');
      return note;
    }

    const clone = orig.cloneNode(false); // shallow — we'll rebuild children
    const computed = cs(orig);

    // Base Tailwind classes + variants
    const twClasses = generateTailwindClasses(computed, orig, parentComputed);
    let variantClasses = '';
    try { variantClasses = extractVariants(orig, ruleCache); } catch (e) { }
    const combinedTw = [twClasses, variantClasses].filter(Boolean).join(' ');
    if (combinedTw) clone.setAttribute('data-tw', combinedTw);

    // Universal inline styles
    const inlineStyles = generateInlineStyles(computed, orig, parentComputed);
    if (inlineStyles) clone.setAttribute('data-inline-style', inlineStyles);

    // Pseudo-element capture
    const pseudo = capturePseudos(orig);
    if (pseudo) {
      pseudoCss.push(pseudo.cssText);
      clone.classList.add(pseudo.className);
    }

    // @keyframes recovery
    collectKeyframes(computed, ruleCache.keyframes, keyframesUsed);

    // Image fix
    if (clone.tagName === 'IMG') {
      clone.src = orig.currentSrc || orig.src;
      clone.removeAttribute('srcset');
      clone.removeAttribute('loading');
    }
    // Canvas marker
    if (orig.tagName === 'CANVAS') {
      clone.setAttribute('data-width', orig.width);
      clone.setAttribute('data-height', orig.height);
    }

    // Shadow DOM — inline its contents into the clone as light DOM children.
    // Many web apps (Spotify, YouTube, custom <encore-*> components) render
    // their actual UI inside shadow roots; without this, we capture empty shells.
    if (orig.shadowRoot) {
      // Collect shadow root stylesheets (scoped styles that won't apply after flattening)
      try {
        for (const sheet of orig.shadowRoot.styleSheets) {
          try {
            for (const rule of sheet.cssRules) shadowCss.push(rule.cssText);
          } catch (e) { }
        }
      } catch (e) { }
      // Constructable stylesheets (modern pattern)
      try {
        const adopted = orig.shadowRoot.adoptedStyleSheets || [];
        for (const sheet of adopted) {
          try {
            for (const rule of sheet.cssRules) shadowCss.push(rule.cssText);
          } catch (e) { }
        }
      } catch (e) { }

      // Recurse shadow children into the clone
      for (const sc of orig.shadowRoot.childNodes) {
        appendChildNode(sc, clone, computed);
      }
    }

    // Light DOM children (and text nodes)
    for (const lc of orig.childNodes) {
      appendChildNode(lc, clone, computed);
    }

    return clone;
  }

  function appendChildNode(node, parentClone, parentComputed) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      parentClone.appendChild(node.cloneNode());
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const childClone = processElement(node, parentComputed);
    if (childClone) parentClone.appendChild(childClone);
  }

  const clone = processElement(originalEl, null);
  if (!clone) return null;

  // Cleanup
  clone.querySelectorAll('script, noscript').forEach(el => el.remove());
  const allClones = clone.querySelectorAll('*');
  allClones.forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
      else if (attr.name.startsWith('data-') &&
               attr.name !== 'data-tw' &&
               attr.name !== 'data-inline-style' &&
               attr.name !== 'data-width' &&
               attr.name !== 'data-height') {
        el.removeAttribute(attr.name);
      }
    });
    el.removeAttribute('id');
  });
  clone.removeAttribute('id');

  // Fix links to absolute
  clone.querySelectorAll('a').forEach(a => {
    try { a.href = new URL(a.getAttribute('href'), document.baseURI).href; } catch (e) { }
  });

  // Harvest @font-face rules whose families are referenced by the captured
  // tree. Without this, captured components fall back to system fonts when
  // pasted into a destination that doesn't already import the brand font.
  // We DON'T fetch + base64 — we just carry the original @font-face rules
  // (with their url() src) so the destination browser fetches them.
  // Most sites allow cross-origin font loads via CORS headers.
  const fontCss = [];
  try {
    const usedFamilies = new Set();
    const collectFamily = (el) => {
      const inline = el.getAttribute && el.getAttribute('data-inline-style');
      if (!inline) return;
      const m = inline.match(/font-family:\s*([^;]+)/i);
      if (!m) return;
      // Split the stack on commas, strip quotes + whitespace
      for (const tok of m[1].split(',')) {
        const clean = tok.trim().replace(/^["']|["']$/g, '').toLowerCase();
        if (clean) usedFamilies.add(clean);
      }
    };
    collectFamily(clone);
    clone.querySelectorAll('[data-inline-style]').forEach(collectFamily);

    for (const ff of (ruleCache.fontFaces || [])) {
      if (!ff.family) continue;
      if (usedFamilies.has(ff.family.toLowerCase())) {
        fontCss.push(ff.cssText);
      }
    }
  } catch (e) { /* best effort */ }

  // Assemble traveling <style> block — order: fonts first (so @font-face
  // rules register before anything tries to use them), then pseudo, keyframes,
  // shadow DOM CSS.
  const keyframeCss = Object.values(keyframesUsed).join('\n');
  const shadowCssBlock = shadowCss.join('\n');
  const extraCss = [
    fontCss.join('\n'),
    pseudoCss.join(''),
    keyframeCss,
    shadowCssBlock
  ].filter(Boolean).join('\n');

  // Ancestor context — captured once, surfaced so portable-output modes
  // (Universal / JSX) can wrap the clone in a context-preserving div.
  let ancestorContext = null;
  try { ancestorContext = captureAncestorContext(originalEl, cs); } catch (e) { /* tests */ }

  return { clone, extraCss, ancestorContext };
}

// =============================================================================
// 10. INSPECTOR UI + MESSAGE BUS
// =============================================================================

function createHighlighter() {
  if (document.getElementById("easydiv-highlighter")) return;
  highlightBox = document.createElement("div");
  highlightBox.id = "easydiv-highlighter";
  Object.assign(highlightBox.style, {
    position: "absolute",
    border: "2px solid #22c55e",
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    pointerEvents: "none",
    zIndex: "2147483647",
    borderRadius: "4px",
    transition: "all 0.05s ease"
  });
  document.body.appendChild(highlightBox);
}

function highlight(el) {
  if (!highlightBox) createHighlighter();
  const rect = el.getBoundingClientRect();
  Object.assign(highlightBox.style, {
    top: rect.top + window.scrollY + "px",
    left: rect.left + window.scrollX + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    display: "block"
  });
}

function saveToDock(el) {
  if (el.id === "easydiv-highlighter" || el.closest("#easydiv-highlighter")) return;

  const frozen = freezeElement(el);
  if (!frozen) return;

  const frozenHTML = frozen.clone.outerHTML;
  const extraCss = frozen.extraCss;

  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => link.href)
    .filter(href => href && !href.includes('chrome-extension://'));

  const hasLottie = detectLottie(el);
  const lottieData = hasLottie ? extractLottieData() : [];

  const newItem = {
    id: Date.now(),
    timestamp: new Date().toLocaleTimeString(),
    source: window.location.hostname,
    url: window.location.href,
    html: frozenHTML,
    extraCss: extraCss,
    ancestorContext: frozen.ancestorContext || null,
    stylesheets: stylesheets,
    hasLottie: hasLottie,
    lottieData: lottieData
  };

  chrome.storage.local.get({ dockItems: [] }, (result) => {
    const items = result.dockItems;
    items.unshift(newItem);
    if (items.length > 20) items.pop();

    chrome.storage.local.set({ dockItems: items }, () => {
      const msg = hasLottie ? "Captured! (Lottie animation detected)" : "Captured! (Saved to Dock)";
      showToast(msg);
    });
  });
}

function copyElementToClipboard(el) {
  const frozen = freezeElement(el);
  if (!frozen) return;
  const html = frozen.clone.outerHTML;
  const output = frozen.extraCss ? `<style>${frozen.extraCss}</style>\n${html}` : html;
  navigator.clipboard.writeText(output).then(() => showToast("Copied to clipboard!"));
}

// Auto-scrape the page: run detector, freeze every candidate, store as dock items
// with a `category` field. Returns { count, groups: { type → count } }.
function scrapePage() {
  if (!window.__easyDivDetector) {
    throw new Error('Detector not loaded');
  }
  const { candidates, groups } = window.__easyDivDetector.scanPage(document);
  const ruleCache = buildRuleCache();
  const ts = new Date().toLocaleTimeString();
  const source = window.location.hostname;
  const url = window.location.href;

  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => link.href)
    .filter(href => href && !href.includes('chrome-extension://'));

  const items = [];
  const MAX_DESCENDANTS = 600; // avoid capturing whole-page clusters like <body>
  for (const c of candidates) {
    try {
      // Cheap pre-check on the live element — avoids freezing huge subtrees
      const liveDescendants = c.el.getElementsByTagName ? c.el.getElementsByTagName('*').length : 0;
      if (liveDescendants > MAX_DESCENDANTS) continue;

      const frozen = freezeElement(c.el, ruleCache);
      if (!frozen) continue;

      // Skip trivially empty captures — no text, no images, no meaningful descendants
      const textLen = (frozen.clone.textContent || '').trim().length;
      const mediaCount = frozen.clone.querySelectorAll('img, svg, video, canvas, picture').length;
      const descendantCount = frozen.clone.querySelectorAll('*').length;
      if (textLen === 0 && mediaCount === 0 && descendantCount < 2) continue;

      const hasLottie = detectLottie(c.el);
      items.push({
        id: Date.now() + items.length,
        timestamp: ts,
        source, url,
        html: frozen.clone.outerHTML,
        extraCss: frozen.extraCss,
        ancestorContext: frozen.ancestorContext || null,
        stylesheets,
        hasLottie,
        lottieData: hasLottie ? extractLottieData() : [],
        category: c.type,
        score: c.score,
        reason: c.reason
      });
    } catch (e) {
      console.warn('EasyDiv: failed to freeze candidate', c, e);
    }
  }

  const groupCounts = {};
  for (const t in groups) groupCounts[t] = groups[t].length;

  return { items, groupCounts, scanned: candidates.length, captured: items.length };
}

function onMouseMove(e) {
  if (!inspectorActive) return;
  if (e.target.id === "easydiv-highlighter") return;
  highlight(e.target);
}

function onClick(e) {
  if (!inspectorActive) return;
  e.preventDefault();
  e.stopPropagation();
  saveToDock(e.target);
}

function onKeyDown(e) {
  if (e.key === "Escape" && inspectorActive) {
    toggleInspection(false);
    showToast("Inspector deactivated");
  }
}

function toggleInspection(active) {
  inspectorActive = active;
  if (active) {
    createHighlighter();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "crosshair";
    showToast("Click any element to steal it");
  } else {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "";
    if (highlightBox) highlightBox.style.display = "none";
  }
}

function copyFullPage() {
  try {
    const html = document.documentElement.outerHTML;
    return navigator.clipboard.writeText(html);
  } catch (e) {
    console.error('EasyDiv: Failed to copy page', e);
    return Promise.reject(e);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleInspection") {
    toggleInspection(request.isActive);
    sendResponse({ success: true });
  }

  if (request.action === "copyFullPage") {
    copyFullPage()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "scrapePage") {
    if (window !== window.top) return false;
    try {
      const result = scrapePage();
      // Merge scraped items into dock (newest first, soft cap at 100 for scrape results)
      chrome.storage.local.get({ dockItems: [] }, (store) => {
        const existing = store.dockItems || [];
        const merged = [...result.items, ...existing].slice(0, 100);
        chrome.storage.local.set({ dockItems: merged }, () => {
          sendResponse({
            success: true,
            scanned: result.scanned,
            captured: result.captured,
            groupCounts: result.groupCounts
          });
        });
      });
    } catch (e) {
      console.error('EasyDiv: scrapePage failed', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }

  if (request.action === "getRawCode") {
    if (window !== window.top) return false;
    try {
      const clonedDoc = document.documentElement.cloneNode(true);
      clonedDoc.querySelectorAll('#easydiv-highlighter, #easydiv-toast').forEach(el => el.remove());
      sendResponse({ success: true, html: clonedDoc.outerHTML, url: window.location.href });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }

  if (request.action === "getStatus") {
    sendResponse({ success: true, isActive: inspectorActive });
  }

  if (request.action === "ping") {
    if (window === window.top) sendResponse({ status: "alive" });
  }

  return true;
});

function showToast(msg) {
  const existing = document.getElementById("easydiv-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.id = "easydiv-toast";
  t.innerText = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "20px", right: "20px",
    background: "#0a0a0a",
    color: "#ededed",
    border: "1px solid #2a2a2e",
    borderLeft: "2px solid #22c55e",
    padding: "10px 16px",
    borderRadius: "6px",
    zIndex: "2147483647",
    boxShadow: "0 8px 20px -4px rgba(0, 0, 0, 0.6)",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    fontSize: "13px",
    fontWeight: "500",
    letterSpacing: "-0.01em"
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// Expose engine internals for testing via devtools
if (typeof window !== 'undefined') {
  window.__easyDivEngine = {
    pxToTw, normalizeColor, radiusToTw, parseMatrix,
    generateTailwindClasses, generateInlineStyles,
    buildRuleCache, extractVariants, capturePseudos,
    captureAncestorContext,
    freezeElement,
    PREFLIGHT_CSS
  };
}
