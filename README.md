# EasyDiv

A Chrome extension that extracts UI components from any website — as clean
Tailwind CSS, inline styles, or React/JSX. Open source, local-only, no AI.

EasyDiv does three things the paid competitors don't:

1. **Scrape a whole page in one click.** Auto-detects every reusable component
   (headers, navs, forms, cards, buttons, sibling-clustered lists…) and files
   them into a categorized dock. Most tools only capture one element at a time.
2. **Inspect any Chrome extension.** Built-in decompiler fetches the CRX by ID
   or Chrome Web Store URL, strips the header, reads the ZIP, and shows the
   file tree with source viewer and parsed manifest summary.
3. **Edit before you copy.** Inline HTML editor in the preview lets you trim
   ancestors, strip noise classes, and save back to the dock.

All conversion runs in the browser — no server, no telemetry, no API key.

---

## Install

```bash
git clone https://github.com/CelestialBrain/easydiv.git
```

1. Visit `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `easydiv/` folder
4. Pin **EasyDiv** to the toolbar and/or open DevTools → **EasyDiv** tab

No package install needed to use the extension. (`npm install` is only for
running the test suites — see [Testing](#testing).)

---

## Usage

### Capture a single element

1. Click the EasyDiv icon
2. **Activate Inspector** → hover any element on the page (green highlight)
3. Click to capture → it lands in **Captured components**
4. Click **Copy ▾** on a dock item and pick a mode:
   - **HTML** — original markup with your captured data attached (`data-tw`, `data-inline-style`)
   - **Tailwind** — `data-tw` promoted to `class`, inline styles stripped
   - **Universal** — `data-inline-style` baked into `style` attrs, zero external deps
   - **JSX** — React/JSX output with `className`, camelCase SVG attrs, `style={{...}}` objects, self-closing void elements
5. Click **View** to open a full-screen preview with mode switching and inline editor

### Scrape the whole page

1. Click **Scrape Page** in the popup
2. EasyDiv runs its detector (tag + ARIA + class hints + structural sibling
   clustering + landmark detection), freezes every candidate, and populates
   the dock — categorized as `header`, `footer`, `nav`, `form`, `section`,
   `card`, `button`, `hero`, `list`, `grid`, `modal`, `table`, `input`, `badge`
3. Click a category pill (`all (29)` / `header (5)` / …) to filter
4. On Stripe the homepage scrapes ~29 components in about 200ms

### Edit before copy

1. Click **View** on any dock item
2. In the preview, click **Edit**
3. Raw HTML textarea slides in at the top
4. Edit, **Apply to preview** (or ⌘/Ctrl+Enter) to see changes
5. **Save to dock** writes the edited HTML back for the next copy

### Inspect another extension

1. Click the **wrench icon** in the popup header
2. Paste an extension ID (32 lowercase letters) or Chrome Web Store URL
3. EasyDiv downloads the CRX, parses the ZIP in-browser, and shows the
   file tree + source viewer + manifest summary (name, version, permissions
   flagged dangerous in amber, content-script match patterns)

### Customize

Open the settings gear in the popup header for:

- **Tailwind version** — v3 (default) or v4. Toggling v4 renames
  `shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`, `rounded`→`rounded-sm`,
  `bg-gradient-to-r`→`bg-linear-to-r`, `outline-none`→`outline-hidden`,
  `ring`→`ring-3`, `blur`→`blur-sm`, `drop-shadow`→`drop-shadow-sm`
- **Custom color palette** — paste a `tailwind.config.js` colors block
  (or plain JSON). Captures now emit `bg-primary` / `text-brand-500`
  instead of arbitrary rgb values

---

## What the engine does

The Tailwind emitter is hand-written — no external compiler, no server call.
It reads computed styles and emits idiomatic Tailwind utilities.

### Base conversion

- Display, position, flex/grid container + item props (context-aware — won't
  emit `flex-direction` on a non-flex container)
- Spacing scale (padding/margin/top/bottom/…) with nearest-neighbor snapping
  to Tailwind's `0, px, 0.5, 1, 1.5, … 96` scale, 2.5px tolerance
- Font-size tiers (`text-xs` through `text-9xl`)
- Font-weight, font-family (serif/sans/mono detection)
- Letter-spacing (`tracking-tight` / `tracking-wide` / …)
- Line-height (`leading-none` / `leading-tight` / … or ratio-based or px-based)
- Borders: per-side widths, styles, colors, plus per-corner radius with named
  tiers (`rounded-sm` / `rounded-md` / `rounded-lg` / `rounded-full`)
- Shadows: named tier matching (`shadow-sm` through `shadow-2xl`, `shadow-inner`)
- Transforms: matrix decomposition into `scale-*`, `rotate-*`, `translate-x/y-*`
- Opacity tiers (`opacity-50`, `opacity-75`, …) + arbitrary fallback
- Transitions: property mapping (`transition-colors` / `transition-opacity` /
  `transition-transform`), duration tiers (`duration-150`…), easing

### Palette matching

Exact RGB-keyed lookup against the full Tailwind v3 default palette (22 colors
× 11 shades + `black` + `white`). Matches emit named tokens:

```
rgb(239, 68, 68)             → red-500
rgba(239, 68, 68, 0.5)       → red-500/50       (snapped to Tailwind opacity tier)
rgba(239, 68, 68, 0.37)      → red-500/35       (within 2% tolerance)
rgb(12, 34, 56)              → [rgb(12,34,56)]  (no palette match → arbitrary)
```

Custom palette from your `tailwind.config.js` takes precedence — a project's
`primary: '#3b82f6'` wins over the default `blue-500`.

### Variants (the big gap in DivMagic's output)

EasyDiv walks every stylesheet on the page (including adopted/constructable
and shadow-root stylesheets) and extracts rules matching the captured element:

- **State pseudo-classes** → `hover:`, `focus:`, `focus-visible:`,
  `focus-within:`, `active:`, `disabled:`, `checked:`, `visited:`,
  `placeholder-shown:`, `first:`, `last:`, `odd:`, `even:`, `empty:`,
  `required:`, `optional:`, `invalid:`
- **Responsive breakpoints** from `@media (min-width: …)` → `sm:`, `md:`, `lg:`,
  `xl:`, `2xl:`, or arbitrary `min-[900px]:` for non-standard widths
- **Dark mode** from `@media (prefers-color-scheme: dark)` → `dark:`
- **Motion preferences** → `motion-reduce:`, `motion-safe:`
- **Orientation / print** → `portrait:`, `landscape:`, `print:`

Variants compose (e.g. `md:dark:hover:bg-slate-900`).

### Pseudo-elements

`::before` and `::after` are captured via `getComputedStyle(el, '::after')`.
Each pseudo gets a unique marker class (`ed-p-42`) attached to the parent,
with a corresponding CSS rule packaged into the capture's `extraCss` block so
the pseudo travels with the component.

### @keyframes recovery

Elements with `animation-name` get their `@keyframes` rule harvested from the
stylesheet set and inlined into `extraCss`. Copies render with animation
intact.

### Shadow DOM

The freezer walks shadow roots and inlines their content as light-DOM children
of the clone. Shadow stylesheets (including adopted ones) are harvested into
`extraCss`. Works on Spotify / YouTube / custom `<encore-*>` components that
other tools fail on.

### iframes

- **Same-origin**: body content inlined, stylesheets harvested.
- **Cross-origin**: replaced by a dashed-border placeholder sized to the iframe's
  bounding rect, marked `data-iframe-skipped="cross-origin"`.

### Linear-gradient matcher

Parses `linear-gradient(<angle>, <stops>)`, normalizes angles
(including `0.5turn` / `rad` / `grad` / `to top right` keyword forms) to one
of the 8 Tailwind directions (`t`, `tr`, `r`, `br`, `b`, `bl`, `l`, `tl`),
maps 2–3 canonical stops to `from-* [via-*] to-*`. Falls back to arbitrary for
radial/conic/non-canonical positions/stacked gradients.

### Noise filters

Output quality is ~50 KB total — cleaner than competitors that bundle the
whole Tailwind compiler. The engine drops:

- Inherited properties matching parent (no `font-family: Inter` on every child)
- Per-tag default display (`display: table` on `<table>`)
- Viewport-width widths (no `w-[1440px]` baked into wrappers)
- Empty SVG children (no `flex-direction: row` on `<path>`)
- Zero-duration transitions (`transition: all 0s` → nothing)
- `border-*-color` when `border-*-width` is `0px`
- Background props when no background image or color
- Default keyword values (`object-fit: fill`, `user-select: auto`, `align-items: normal`)
- Gap on non-flex/grid elements

### Fidelity (portability) fixes — v2.1

Universal- and JSX-mode copies ship with three additions so they render the
same when pasted elsewhere:

- **Minimal Tailwind preflight reset** is prepended to the traveling
  `<style>` block. Kills `<a>` underlines, `<ul>`/`<ol>` bullets, default
  button chrome, heading font-size cascades, and default margins that would
  otherwise reappear on a page without its own reset.
- **Ancestor context wrapper** — freeze captures the element's parent-chain
  background (color + image), inherited color, and font-family. Also captures
  the immediate parent's flex/grid layout (`display`, `gap`, `flex-direction`,
  `grid-template-columns`, `width`). Copies wrap the captured root in up to
  two `<div>` wrappers (`data-ed-ancestor-context`, `data-ed-parent-layout`)
  so flex children don't collapse and dark-bg headers show the right
  background when rendered standalone.
- **@font-face harvest** — `buildRuleCache` scans every same-origin
  stylesheet for `@font-face` rules, keyed by family name. After freezing,
  the engine collects font families referenced in the clone and emits
  matching `@font-face` rule text into `extraCss`. Fonts load from their
  original URLs when CORS permits (Google Fonts, most CDNs do).

Measured pixel-diff fidelity across 16 real-site components
(via `test/test_fidelity.js`): **77% mean, 94–99% on well-captured cases.**
See the [Fidelity](#fidelity) section below.

---

## Architecture

```
easydiv/
├── manifest.json           # MV3 manifest (options_page + devtools_page)
├── background.js           # service worker: per-tab inspector state
├── content.js              # engine (freeze/emit) + inspector + scrapePage
├── detector.js             # component detector (tags, ARIA, class hints, sibling clusters)
├── popup.html / .js        # toolbar popup UI
├── options.html / .js      # settings (TW version + custom palette)
├── decompiler.html / .js   # CRX fetch + ZIP parser + file tree
├── devtools.html / .js     # DevTools panel registration
├── preview.html / .js      # full-screen preview + inline editor
├── styles.css              # injected inspector styles
├── icons/                  # 16/32/48/128 toolbar icons
├── test/
│   ├── test_pxToTw.js      # unit: converters + gradient parser
│   ├── test_detector.js    # unit + jsdom integration against fixtures
│   ├── test_e2e.js         # Playwright engine E2E (12 real sites)
│   ├── test_extension.js   # Playwright full-extension E2E (scrape+popup+copy)
│   ├── test_fidelity.js    # pixel-diff fidelity measurement
│   └── fixtures/           # pinned HTML snapshots (HN, Vercel, Linear, etc.)
├── README.md
├── CHANGELOG.md
└── package.json
```

Content scripts run in the page's isolated world; engine internals are exposed
on `window.__easyDivEngine` and detector on `window.__easyDivDetector` for
testing.

Tailwind classes are stored as `data-tw` attributes during capture; inline
styles as `data-inline-style`. The popup's copy-mode processor swaps these
into real `class` / `style` attributes depending on which mode the user picks.

---

## Testing

Five test tiers from fastest to most realistic. Run individually via
`node test/test_<name>.js` or via the npm shortcuts:

```bash
npm test               # unit + detector   (~1s)
npm run test:e2e       # engine E2E across 12 real sites  (~4 min)
npm run test:ext       # full-extension E2E on Stripe     (~30s)
npm run test:fidelity  # pixel-diff fidelity on 16 components  (~3 min)
npm run test:all       # everything
```

What each one does:

1. **`test/test_pxToTw.js`** — 65 pure unit tests. Covers `pxToTw`,
   `normalizeColor` (+ palette matching + alpha snap), `radiusToTw`,
   `parseMatrix`, `mediaToPrefix` (incl. dark mode / motion / orientation),
   `splitSelectorState`, and the linear-gradient parser.
2. **`test/test_detector.js`** — 12 unit tests + jsdom integration against
   5 pinned HTML fixtures (HN, Vercel, Linear, Tailwind UI, Stripe Pricing).
   Covers type-tier dedup rules, sibling clustering, shadow-DOM traversal.
3. **`test/test_e2e.js`** — Playwright engine E2E. Injects the engine into
   12 real sites (Stripe, Linear, Vercel, Discord, Notion, Tailwind CSS,
   shadcn/ui, MDN, GitHub, Spotify, YouTube, Hacker News), runs `scanPage` +
   `freezeElement`, and prints per-site stats — palette-hit rate,
   named-class rate, candidate count, freeze time.
4. **`test/test_extension.js`** — Loads EasyDiv unpacked into real Chromium
   as a persistent context. Exercises the full message flow: content scripts
   inject, `scrapePage` runs, dock populates, popup renders, Copy dropdown
   opens, JSX copies to clipboard. 21 assertions, plus a screenshot of the
   popup to `/tmp/easydiv-popup.png`.
5. **`test/test_fidelity.js`** — Pixel-diff against 16 real components:
   screenshots the original element on the live site, reproduces the
   captured HTML in a fresh page (with preflight + ancestor wrappers +
   extraCss), screenshots the reproduction, and runs `pixelmatch`. Writes
   `orig` / `reproduced` / `diff` PNGs to `/tmp/easydiv-fidelity/` so you
   can eyeball any failure.

## Fidelity

Honest measured fidelity, not a marketing number. Run
`npm run test:fidelity` to reproduce on your machine. Latest results:

| Site | Component | Pixel match |
|---|---|---|
| Notion | button | 99.6% |
| shadcn/ui | footer | 97.8% |
| Vercel | footer | 97.3% |
| Vercel | nav | 96.8% |
| Notion | footer | 96.8% |
| shadcn/ui | header | 95.8% |
| Stripe | footer | 94.1% |
| shadcn/ui | button | 89.9% |
| shadcn/ui | nav | 88.5% |
| Stripe | button | 87.7% |
| Vercel | header | 81.4% |
| Vercel | button | 75.9% |
| Stripe | section | 74.4% |
| Stripe | header | 55.0% |
| Discord | header | 4.7% |
| Discord | button | 0.8% |
| **Mean** | | **77.3%** |

Typical-case components (footers, navs, most buttons, most headers)
reproduce at **94–99%** visual fidelity. Worst cases — elements whose
look depends on JS-animated ancestors (Discord's starry `<canvas>`
background, Spotify's player inner state) — fail because computed-style
capture can't recover JS behavior.

Run individually to see per-site metrics and diff images:
```bash
node test/test_fidelity.js
```

Dependencies: `npm install` once to pull jsdom + playwright + pixelmatch +
pngjs. First Playwright run will also download a Chromium build.

Total: **98+ assertions green + pixel-diff fidelity tracked across feature
batches.**

---

## How we compare

| | DivMagic | ExtractCSS | Windy | EasyDiv |
|---|---|---|---|---|
| Page-wide scraping pipeline | ✗ | ✗ | ✗ | **✓** |
| Open source | ✗ | ✗ | ✗ | **✓** |
| Extension decompiler | ✗ | ✗ | ✗ | **✓** |
| Shadow DOM traversal | minimal | thorough | ? | thorough |
| Hover/focus/active variants | ✗ | ✓ | partial | ✓ |
| Responsive (sm:/md:/lg:) | ✗ | ✓ | ✓ | ✓ |
| Dark mode variant | ✗ | ✓ | ? | ✓ |
| Tailwind color palette match | ✗ | ✓ | ✓ | ✓ |
| Custom palette from config | ✗ | ✗ | ✓ | ✓ |
| Tailwind v4 support | ✗ | partial | ✗ | ✓ |
| JSX/React output | ✓ | ? | ✗ | ✓ |
| Post-capture edit panel | ✓ (Studio) | ✗ | ✗ | ✓ |
| Linear-gradient matcher | ✗ | ✓ | partial | ✓ |
| iframe traversal | ✓ | ? | ✗ | ✓ |
| Pricing | paid | free | paid | **free** |
| Bundle size | 5 MB | 53 MB | ? | **~60 KB** |

Honest gaps: DivMagic has years of polish and a more mature UI; ExtractCSS
ships the actual Tailwind compiler in a web worker for edge-case gradient and
filter accuracy we don't match on complex inputs.

---

## Known limitations

- **Whole-page tables / body wrappers** get rejected by the scraper's
  `MAX_DESCENDANTS=600` cap. Capture individual sub-components instead.
- **Dynamic JS behavior** isn't captured — we snapshot computed styles.
  `onClick`, event bindings, state-driven className changes all drop.
- **Canvas / WebGL content** gets a placeholder div.
- **Cross-origin stylesheets** without CORS headers are invisible — variants
  and `@keyframes` from those sheets can't be extracted.
- **CSS-in-JS sites** with randomized class names (emotion, styled-components,
  CSS Modules) capture fine via computed styles, but the output won't look
  idiomatic — lots of arbitrary-value classes.
- **Tailwind v4 rename pass** covers the common default renames but is not
  exhaustive — run the output through `tailwindcss --watch` to catch stragglers.

---

## Tech stack

- Manifest V3, Chrome 122+
- Vanilla JS (no React/Svelte in the extension itself)
- Chrome Storage API (for dock items + settings)
- Shadow DOM for iframe-isolated previews
- `DecompressionStream('deflate-raw')` for CRX ZIP parsing (no zip library)
- jsdom + Playwright for test harness

---

## License

MIT. See [LICENSE](LICENSE) if present, otherwise see the manifest `author`
field.
