# Changelog

All notable changes to EasyDiv. Versions follow [SemVer](https://semver.org/).

## [2.0.0] — 2026-04

**Major release.** Complete engine rewrite, auto-scraping pipeline, decompiler,
dark-mode rebrand. From "single-element Tailwind grabber" to a full-featured
component extraction platform.

### Added

**Engine v2**
- Hand-written Tailwind emitter with border/shadow/transform/transition/typography
  generators replacing the minimal keyword-map approach.
- Tailwind v3 default color palette (242 entries) with exact RGB matching:
  `rgb(239,68,68)` → `red-500`. Arbitrary fallback for misses.
- Alpha channel → Tailwind opacity notation: `rgba(239,68,68,0.5)` →
  `red-500/50`, with nearest-tier snapping at 2% tolerance.
- Pseudo-element capture (`::before` / `::after`) — inline styles harvested
  via `getComputedStyle(el, pseudo)`, packaged into a traveling `<style>`
  block keyed by unique marker classes (`ed-p-42`).
- `@keyframes` recovery — elements with `animation-name` get their keyframes
  rule harvested from any stylesheet and inlined so animations travel with
  the copy.
- Stylesheet scanner with shadow-root + adopted-stylesheet support.
- Variant extraction: `hover:`, `focus:`, `focus-visible:`, `focus-within:`,
  `active:`, `disabled:`, `checked:`, `visited:`, `placeholder-shown:`,
  `first:`, `last:`, `odd:`, `even:`, `empty:`, `required:`, `optional:`,
  `invalid:`.
- Responsive extraction from `@media (min-width: …)` — emits `sm:` / `md:`
  / `lg:` / `xl:` / `2xl:` or arbitrary `min-[900px]:` for custom breakpoints.
- Dark mode variant from `@media (prefers-color-scheme: dark)` → `dark:`.
- Motion / print / orientation variants (`motion-reduce:`, `motion-safe:`,
  `print:`, `portrait:`, `landscape:`).
- Composed variants: `md:dark:hover:bg-slate-900`.
- Linear-gradient matcher: parses `linear-gradient(<angle>, <stops>)`, maps
  the 8 cardinal/diagonal angles (including `0.5turn`, `to top right`
  keyword forms) to Tailwind directions, emits idiomatic
  `bg-gradient-to-br from-* via-* to-*`. Falls back to arbitrary for
  radial/conic/non-canonical positions.
- Matrix transform decomposition: emits `scale-*` / `rotate-*deg` /
  `translate-x/y-*` from a computed `matrix(...)`.
- Shadow DOM traversal in both freezer and detector — inlines shadow content
  as light DOM, harvests shadow stylesheets. Makes Spotify / YouTube /
  custom-element sites capturable.
- iframe traversal — same-origin inlining, cross-origin placeholder with
  visible skipped-note.
- Per-tag default display filter (no `display: table` on `<table>`, no
  `display: list-item` on `<li>`).
- Viewport/parent-width filter — drops `w-[1440px]` when the width is
  layout-derived rather than explicitly set.
- Inherited-property filter — descendants skip inherited values that equal
  their parent's, cutting output size ~50%.
- SVG-child filter — `<path>`, `<circle>`, `<line>` emit nothing inline since
  SVG uses its own attrs (`fill`, `stroke`).
- Box-sizing de-noise — `box-border` only emits at the reset boundary, not
  on every descendant.
- Computed-style cache per freeze, halving `getComputedStyle` calls on tree
  walks.

**Auto-scraping pipeline**
- New `detector.js` module with six detection passes: landmark tags + ARIA
  roles, button detection, class-name pattern hints (card/modal/hero/nav/…),
  form structure (inputs + submit), sibling-similarity clustering (3+
  children with same structural signature), hero detection (top-of-page
  heading + CTA).
- Type tiers (SCAFFOLD / DOMINANT / LEAF) with smart nesting rules —
  scaffolds drop when they wrap a dominant, dominants dedup against
  themselves, leaves always survive.
- `scrapePage()` action: detects → freezes every candidate → stores in
  dock. On Stripe, yields ~29 categorized components in ~200ms.
- Hard cap at 600 descendants to avoid whole-page captures.
- Empty-capture filter (< 2 descendants, no text, no media) drops trivial
  detections.

**UI**
- Categorized dock with filter pills (`all (29)` / `header (5)` / `button (15)` / …).
- Category badges on each dock item.
- Copy mode dropdown — `Copy ▾` with HTML / Tailwind / Universal / JSX
  options, replacing 4 separate buttons.
- Four copy modes:
  - **HTML**: original markup with data attributes preserved.
  - **Tailwind**: `data-tw` promoted to `class`, inline styles stripped.
    Fragment + `<style>{\`extraCss\`}</style>` wrapper when pseudo/keyframe
    CSS needs to travel.
  - **Universal**: `data-inline-style` baked into `style` attrs. Zero
    external dependencies.
  - **JSX**: React output — `className`, `htmlFor`, 30+ HTML attr
    renames, SVG camelCase (`viewBox`, `strokeWidth`, `fillRule`,
    `clipPath`, `stdDeviation`, …), `style={{color: 'red', fontSize: '16px'}}`
    object conversion, void elements self-closed, `{` / `}` in text escaped.
- DevTools panel integration: popup renders inside a **EasyDiv** tab in
  Chrome DevTools. Auto-detected context: uses
  `chrome.devtools.inspectedWindow.tabId` when in DevTools,
  `chrome.tabs.query` otherwise.
- Settings page (options.html): Tailwind version (v3 / v4) + custom palette
  from a pasted `tailwind.config.js` colors block.
- Extension inspector (decompiler.html): fetches any public CWS extension
  by ID or URL, strips CRX2/CRX3 header, parses ZIP via minimal EOCD reader,
  decompresses with browser-native `DecompressionStream('deflate-raw')` (no
  dependencies), shows file tree + source viewer + manifest summary
  (resolves `__MSG_*__` i18n placeholders).
- Post-capture editor: slide-down textarea in the preview page with
  **Apply to preview** (also ⌘/Ctrl+Enter) and **Save to dock**. Users can
  strip classes, pick ancestors, remove children before copying.
- Monotone dark + green accent aesthetic (replaces the multi-gradient
  carnival of v1).
- Responsive popup body (`width: 100%; min-width: 380px; height: 100vh`)
  so it sizes correctly in both toolbar and DevTools panel contexts.

**Tailwind v4 support**
- Version toggle in settings.
- Single-pass rename map: `shadow-sm` → `shadow-xs`, `shadow` → `shadow-sm`,
  `rounded` → `rounded-sm`, `rounded-sm` → `rounded-xs`, `blur` → `blur-sm`,
  `drop-shadow` → `drop-shadow-sm`, `bg-gradient-to-*` → `bg-linear-to-*`,
  `outline-none` → `outline-hidden`, `ring` → `ring-3`.

**Custom color palette**
- Options page accepts full Tailwind configs, colors blocks, or plain JSON.
- Parser handles JS-literal syntax (unquoted keys, single quotes, trailing
  commas, comments).
- Flattens nested objects including Tailwind's `DEFAULT` convention.
- Normalizes hex / rgb / rgba / hsl / 17 named CSS colors.
- User palette takes precedence when RGB keys collide with defaults.

**Tests**
- `test_pxToTw.js` — 65 assertions. pxToTw, normalizeColor, radiusToTw,
  parseMatrix, mediaToPrefix, splitSelectorState, parseLinearGradient.
- `test_detector.js` — 12 unit tests + integration against 5 real-site
  HTML fixtures (HN, Vercel, Linear, Tailwind UI, Stripe Pricing).
- `test_e2e.js` — Playwright engine E2E against 5 real sites in Chromium.
- `test_extension.js` — full-extension E2E: loads EasyDiv unpacked, runs
  actual scrape→storage→popup→JSX-copy→clipboard flow, screenshots popup.

### Fixed

- Pre-v2 bug: `generateTailwindClasses` was called without the `element`
  argument, silently crashing on every `element.tagName` access. Was
  causing the tag-default skip filters to never fire.
- `data-inline-style` attribute leaking into the preview page's copied
  HTML in "Original" mode.
- Dock preview was rendering the original stylesheets which fail to load
  for auth-gated CDNs (Spotify) — now uses universal mode for guaranteed
  render fidelity without network dependencies.
- Arbitrary values with spaces (`gap-[normal 24px]`) weren't accepted by
  Tailwind JIT — now underscore-escaped (`gap-[normal_24px]`).
- Non-rgb CSS colors (`lab(...)`, `oklch(...)`) were being mangled by
  whitespace-stripping — now preserved with underscore-escaped spaces.
- SVG `viewBox` and other camelCase attrs were lowercased in JSX output —
  now 20+ SVG attributes handled explicitly.
- `box-border` was emitted on every descendant — now only at the reset
  boundary where parent differs.

### Changed

- Extension renamed "EasyDiv - Tailwind Component Stealer" →
  "EasyDiv - Design Stealer".
- Default inspector highlight color: purple → green.
- Toast notification: gradient pill → flat `bg-0` with 2px green left-border.

---

## [1.2.0] — 2026-04 (pre-v2)

- Smart Tailwind conversion with default filtering.
- Universal inline-style mode.
- Lottie animation detection + library injection.
- Dock preview with Tailwind CDN + original stylesheets fallback.

## [1.1.x] — 2026-04

- Inspector click capture.
- Basic Tailwind conversion via `getComputedStyle` + keyword map.
- Component dock (up to 20 items).
- Full-page preview.
- Canvas placeholder.

## [1.0.0] — 2026-04

Initial release. Chrome extension that captures any UI element and emits
Tailwind CSS classes via computed-style mapping.
