// EasyDiv options page
//
// Parses a user-supplied Tailwind config (or bare JSON) into a flat
// { "name-shade": "#rrggbb" } map, then stores a normalized { "r,g,b": "name-shade" }
// lookup in chrome.storage.local.userPalette so content.js can merge it into TW_PALETTE.
//
// Accepts:
//   - Plain JSON: { "primary": "#f00", "brand": { "500": "#bada55" } }
//   - colors block from a Tailwind config: colors: { primary: '#f00', ... }
//   - Full module.exports = { theme: { extend: { colors: { ... } } } }

const input = document.getElementById('config-input');
const status = document.getElementById('status');
const palettePreview = document.getElementById('palette-preview');
const saveBtn = document.getElementById('save');
const resetBtn = document.getElementById('reset');

const NAMED_CSS_COLORS = {
    black: '#000000', white: '#ffffff',
    red: '#ff0000', green: '#008000', blue: '#0000ff',
    yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
    gray: '#808080', grey: '#808080',
    silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
    purple: '#800080', teal: '#008080', navy: '#000080',
    orange: '#ffa500', transparent: null, currentcolor: null
};

// ----- parsing -----

function stripJsComments(s) {
    return s
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

// Pull the `colors:` object out of a full Tailwind config paste.
// Matches `colors: { … }` balanced by tracking brace depth.
function extractColorsBlock(text) {
    const idx = text.search(/\bcolors\s*:/);
    if (idx < 0) return null;
    const open = text.indexOf('{', idx);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(open, i + 1);
        }
    }
    return null;
}

// Convert a JS object literal to something JSON.parse can handle.
// Not a full JS parser, just enough for typical tailwind colors blocks.
function jsObjectToJson(text) {
    return text
        .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":') // quote keys
        .replace(/'/g, '"')                                            // single → double
        .replace(/,(\s*[}\]])/g, '$1');                                // trailing commas
}

function parseUserConfig(text) {
    text = stripJsComments(text.trim());
    if (!text) return {};

    // If the paste looks like a full config, carve out the colors block.
    if (text.includes('theme') || text.includes('module.exports') || text.includes('export default')) {
        const block = extractColorsBlock(text);
        if (block) text = block;
    } else {
        const block = extractColorsBlock(text);
        if (block && block.length < text.length) text = block;
    }

    try { return JSON.parse(text); } catch (e) { /* fall through */ }
    try { return JSON.parse(jsObjectToJson(text)); } catch (e) {
        throw new Error(`Could not parse: ${e.message}`);
    }
}

// Flatten nested Tailwind color objects into `{ "name-shade": "#rrggbb" }`.
// Handles the `DEFAULT` key convention (maps to the parent name).
function flattenColors(obj, prefix = '') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const name = prefix ? `${prefix}-${k}` : k;
        if (typeof v === 'string') {
            out[name] = v;
        } else if (v && typeof v === 'object') {
            if (typeof v.DEFAULT === 'string') out[prefix || k] = v.DEFAULT;
            for (const [k2, v2] of Object.entries(v)) {
                if (k2 === 'DEFAULT') continue;
                if (typeof v2 === 'string') {
                    out[`${name}-${k2}`] = v2;
                } else if (v2 && typeof v2 === 'object') {
                    Object.assign(out, flattenColors({ [k2]: v2 }, name));
                }
            }
        }
    }
    return out;
}

// ----- color normalization -----

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 8) hex = hex.slice(0, 6); // strip alpha
    if (hex.length !== 6) return null;
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return null;
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function cssColorToRgb(str) {
    if (!str || typeof str !== 'string') return null;
    const s = str.trim().toLowerCase();
    if (NAMED_CSS_COLORS[s] !== undefined) {
        const hex = NAMED_CSS_COLORS[s];
        return hex ? hexToRgb(hex) : null;
    }
    if (s.startsWith('#')) return hexToRgb(s);
    let m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
        || s.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/);
    if (m) return [+m[1], +m[2], +m[3]];
    m = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
    if (m) return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    return null;
}

// ----- rendering + storage -----

function renderPreview(flatColors, rgbMap) {
    const entries = Object.entries(flatColors);
    if (entries.length === 0) {
        palettePreview.className = 'palette-empty';
        palettePreview.textContent = 'No custom palette loaded — Tailwind v3 defaults will be used.';
        return;
    }
    palettePreview.className = 'palette-grid';
    palettePreview.innerHTML = entries.map(([name, color]) => {
        const rgb = rgbMap[name];
        const bg = rgb ? `rgb(${rgb})` : color;
        return `<div class="palette-chip">
            <span class="palette-swatch" style="background:${bg}"></span>
            ${name}
        </div>`;
    }).join('');
}

function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = 'status' + (kind ? ' ' + kind : '');
    if (kind === 'ok') setTimeout(() => { status.textContent = ''; status.className = 'status'; }, 2500);
}

function buildAndSave(text) {
    let flat;
    try {
        const parsed = parseUserConfig(text);
        flat = flattenColors(parsed);
    } catch (e) {
        setStatus('Parse error: ' + e.message, 'err');
        return;
    }
    // Build the rgb-key → name map content.js consumes.
    const rgbKey = {};       // "r,g,b" → "name"
    const rgbValues = {};    // "name" → "r,g,b" (for UI preview)
    for (const [name, color] of Object.entries(flat)) {
        const rgb = cssColorToRgb(color);
        if (!rgb) continue;
        const key = rgb.join(',');
        rgbKey[key] = name;
        rgbValues[name] = key;
    }
    chrome.storage.local.set({
        userPaletteSource: text,
        userPalette: rgbKey
    }, () => {
        const count = Object.keys(rgbKey).length;
        if (count === 0) setStatus('No valid colors found', 'err');
        else setStatus(`Saved ${count} colors`, 'ok');
        renderPreview(flat, rgbValues);
    });
}

function load() {
    chrome.storage.local.get({ userPaletteSource: '', userPalette: {} }, (res) => {
        input.value = res.userPaletteSource;
        if (res.userPaletteSource) {
            try {
                const flat = flattenColors(parseUserConfig(res.userPaletteSource));
                const rgbValues = {};
                for (const [name, color] of Object.entries(flat)) {
                    const rgb = cssColorToRgb(color);
                    if (rgb) rgbValues[name] = rgb.join(',');
                }
                renderPreview(flat, rgbValues);
            } catch (e) { /* show empty */ }
        }
    });
}

// ----- Tailwind version toggle -----
const twV3 = document.getElementById('tw-v3');
const twV4 = document.getElementById('tw-v4');
const twVersionStatus = document.getElementById('tw-version-status');

function setVersionStatus(msg, kind) {
    twVersionStatus.textContent = msg;
    twVersionStatus.className = 'status' + (kind ? ' ' + kind : '');
    if (kind === 'ok') setTimeout(() => {
        twVersionStatus.textContent = '';
        twVersionStatus.className = 'status';
    }, 2000);
}

chrome.storage.local.get({ twVersion: 'v3' }, (res) => {
    (res.twVersion === 'v4' ? twV4 : twV3).checked = true;
});

[twV3, twV4].forEach(el => el.addEventListener('change', () => {
    const v = twV3.checked ? 'v3' : 'v4';
    chrome.storage.local.set({ twVersion: v }, () => setVersionStatus(`Set to ${v}`, 'ok'));
}));

saveBtn.addEventListener('click', () => buildAndSave(input.value));
resetBtn.addEventListener('click', () => {
    input.value = '';
    chrome.storage.local.set({ userPaletteSource: '', userPalette: {} }, () => {
        setStatus('Reset — using Tailwind defaults', 'ok');
        renderPreview({}, {});
    });
});

load();
