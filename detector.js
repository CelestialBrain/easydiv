// =============================================================================
// EasyDiv Component Detector
//
// Scans a DOM tree and returns candidate "reusable components" grouped by type.
// Pure heuristics — no AI, no external calls. Runs in both browser and Node+jsdom.
//
// Signals used:
//   1. Semantic tags (<nav>, <header>, <footer>, <article>, <form>, etc.)
//   2. ARIA roles (role="button", role="dialog", etc.)
//   3. Class-name patterns (btn, card, hero, modal, pricing, testimonial...)
//   4. Structural shape (form has inputs+submit; list has N similar siblings)
//   5. Sibling clustering (3+ children with same tag + same class signature)
//   6. Size/visibility — only applied when layout info available (browser)
// =============================================================================

(function (global) {
  'use strict';

  const TYPE = Object.freeze({
    NAV: 'nav',
    HEADER: 'header',
    FOOTER: 'footer',
    HERO: 'hero',
    CARD: 'card',
    BUTTON: 'button',
    FORM: 'form',
    INPUT: 'input',
    LIST: 'list',
    GRID: 'grid',
    MODAL: 'modal',
    TABLE: 'table',
    SECTION: 'section',
    BADGE: 'badge',
    OTHER: 'other'
  });

  // Class-name patterns (case-insensitive substring / word match)
  const CLASS_HINTS = [
    { type: TYPE.MODAL,       pattern: /\bmodal\b|\bdialog\b|\bdrawer\b|\bpopover\b/i,   score: 75 },
    { type: TYPE.CARD,        pattern: /\bcard\b|\btile\b|\bpanel\b/i,                    score: 60 },
    { type: TYPE.HERO,        pattern: /\bhero\b|\bbanner\b|splash/i,                     score: 70 },
    { type: TYPE.NAV,         pattern: /\bnavbar\b|\bsidebar\b|\bmenu\b/i,                score: 65 },
    { type: TYPE.FOOTER,      pattern: /\bfooter\b/i,                                     score: 65 },
    { type: TYPE.HEADER,      pattern: /\bheader\b|\btoolbar\b|\bmasthead\b/i,            score: 65 },
    { type: TYPE.BUTTON,      pattern: /\bbtn\b|\bbutton\b|\bcta\b/i,                     score: 55 },
    { type: TYPE.BADGE,       pattern: /\bbadge\b|\bchip\b|\btag\b|\bpill\b/i,            score: 40 },
    { type: TYPE.FORM,        pattern: /\bform\b(?!-(control|input))|\bsignin\b|\blogin\b|\bsignup\b/i, score: 50 },
    { type: TYPE.TABLE,       pattern: /\btable\b|\bgrid\b|\bdatagrid\b/i,                score: 55 }
  ];

  // Tag → type for landmark / obvious elements
  const TAG_TYPE = {
    'NAV': TYPE.NAV,
    'HEADER': TYPE.HEADER,
    'FOOTER': TYPE.FOOTER,
    'FORM': TYPE.FORM,
    'ARTICLE': TYPE.SECTION,
    'ASIDE': TYPE.SECTION,
    'MAIN': TYPE.SECTION,
    'SECTION': TYPE.SECTION,
    'DIALOG': TYPE.MODAL,
    'TABLE': TYPE.TABLE
  };

  const ROLE_TYPE = {
    'navigation': TYPE.NAV,
    'banner': TYPE.HEADER,
    'contentinfo': TYPE.FOOTER,
    'dialog': TYPE.MODAL,
    'alertdialog': TYPE.MODAL,
    'button': TYPE.BUTTON,
    'form': TYPE.FORM,
    'search': TYPE.FORM,
    'table': TYPE.TABLE,
    'grid': TYPE.TABLE
  };

  // =====================================================================
  // Helpers
  // =====================================================================

  function clsString(el) {
    // Normalize: DOMTokenList, SVGAnimatedString, or plain string
    const c = el.className;
    if (!c) return '';
    if (typeof c === 'string') return c;
    if (typeof c.baseVal === 'string') return c.baseVal; // SVG
    return '';
  }

  // Strip hash-suffixed class names (CSS Modules, emotion, styled-components).
  // Keeps semantic classes like `hero`, `card__title` but drops `hero-a8b3f9e`.
  function normalizeClassToken(tok) {
    if (!tok) return '';
    // React-style generated: name__a8b3 or _a8b3fe7
    if (/^_[a-z0-9]{5,}$/i.test(tok)) return '';
    // emotion / styled-components: css-x1y2z3 or sc-abc123-0
    if (/^(css|sc|jsx)-[a-z0-9-]{4,}$/i.test(tok)) return '';
    // trailing random hex suffix: component-a8b3f9e → component
    const m = tok.match(/^(.+?)[-_][a-f0-9]{5,}$/i);
    if (m) return m[1];
    return tok.toLowerCase();
  }

  function childSignature(el) {
    // Structural signature: tag + child-count + direct children tags.
    // Class names are too fragile (CSS Modules, emotion) to rely on as a primary
    // key. We do include a normalized class fingerprint as a tiebreaker.
    const tag = el.tagName || '';
    const childCount = el.children ? el.children.length : 0;
    const kidTags = el.children ? Array.from(el.children).map(c => c.tagName).join(',') : '';
    const cls = clsString(el).split(/\s+/).map(normalizeClassToken).filter(Boolean).slice(0, 2).sort().join('.');
    return `${tag}#${childCount}<${kidTags}>${cls ? `.${cls}` : ''}`;
  }

  // Elements we never want to surface as components
  const EXCLUDE_TAGS = new Set([
    'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE',
    'NOSCRIPT', 'TEMPLATE', 'BASE', 'SOURCE', 'TRACK'
  ]);

  function isExcluded(el) {
    return !el || !el.tagName || EXCLUDE_TAGS.has(el.tagName);
  }

  // Walk every element in the tree, descending into shadow roots.
  // Returns a flat array. Order is approximately document order (light DOM
  // children of a host are visited after shadow content, matching render order).
  function collectAllElements(root) {
    const out = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (node.nodeType === 1 /* ELEMENT */) out.push(node);
      // Push in reverse so that document order is preserved when popping
      if (node.shadowRoot) {
        const sc = Array.from(node.shadowRoot.children || []);
        for (let i = sc.length - 1; i >= 0; i--) stack.push(sc[i]);
      }
      const children = node.children;
      if (children) {
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
    }
    return out;
  }

  // Shadow-DOM-aware querySelectorAll. Falls back to document.querySelectorAll
  // when no shadow DOM is present for speed.
  function queryAll(doc, selector) {
    const root = doc.documentElement || doc;
    if (!root) return [];
    const lightHits = Array.from(doc.querySelectorAll(selector));
    // Probe: does any light-DOM element host a shadowRoot?
    let anyShadow = false;
    const all = doc.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) { anyShadow = true; break; }
    }
    if (!anyShadow) return lightHits;
    // Walk entire tree (light + shadow) and filter by selector
    const every = collectAllElements(root);
    return every.filter(el => {
      try { return el.matches(selector); } catch { return false; }
    });
  }

  function getBoundingSafe(el) {
    try { return el.getBoundingClientRect(); }
    catch { return { width: 0, height: 0, top: 0, left: 0 }; }
  }

  function hasLayoutInfo(el) {
    // True when we're running in a real browser with layout engine.
    // jsdom returns 0 for everything, so we skip visual filters there.
    const r = getBoundingSafe(el);
    return r.width > 0 || r.height > 0;
  }

  function isVisibleInBrowser(el) {
    if (!el.offsetWidth && !el.offsetHeight) {
      // Allow position:fixed which can have 0 offsetParent
      if (el.ownerDocument && el.ownerDocument.defaultView) {
        try {
          const cs = el.ownerDocument.defaultView.getComputedStyle(el);
          if (cs.position === 'fixed' && cs.display !== 'none') return true;
        } catch {}
      }
      return false;
    }
    if (el.offsetWidth < 20 || el.offsetHeight < 8) return false;
    return true;
  }

  function ancestorsSeen(el, seen) {
    let p = el.parentElement;
    while (p) { if (seen.has(p)) return true; p = p.parentElement; }
    return false;
  }

  // =====================================================================
  // Individual detectors
  // =====================================================================

  function detectByTagAndRole(doc, candidates, seen) {
    const selector = 'nav, header, footer, main, aside, article, section, form, dialog, table, [role]';
    for (const el of queryAll(doc, selector)) {
      if (seen.has(el) || isExcluded(el)) continue;
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      const type = ROLE_TYPE[role] || TAG_TYPE[el.tagName] || null;
      if (!type) continue;
      // Must have real content — not an empty placeholder
      if (!el.children || el.children.length === 0) {
        // keep empty forms/tables only if they have inputs/rows (covered below)
        if (type !== TYPE.FORM && type !== TYPE.TABLE) continue;
      }
      candidates.push({ el, type, score: 90, reason: role ? `role=${role}` : el.tagName.toLowerCase() });
      seen.add(el);
    }
  }

  function detectButtons(doc, candidates, seen) {
    const sel = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
    for (const el of queryAll(doc, sel)) {
      if (seen.has(el) || isExcluded(el)) continue;
      // Buttons are leaf-like; we don't skip on ancestorsSeen because a button
      // inside a nav/form/card is still a first-class component.
      candidates.push({ el, type: TYPE.BUTTON, score: 80, reason: el.tagName.toLowerCase() });
      seen.add(el);
    }
    for (const el of queryAll(doc, 'a')) {
      if (seen.has(el) || isExcluded(el)) continue;
      const c = clsString(el);
      if (/\bbtn\b|\bbutton\b|\bcta\b/i.test(c)) {
        candidates.push({ el, type: TYPE.BUTTON, score: 72, reason: 'a.btn' });
        seen.add(el);
      }
    }
  }

  function detectByClassHints(doc, candidates, seen) {
    for (const el of queryAll(doc, '*')) {
      if (seen.has(el) || isExcluded(el)) continue;
      const c = clsString(el);
      if (!c) continue;
      for (const hint of CLASS_HINTS) {
        if (hint.pattern.test(c)) {
          if (ancestorsSeen(el, seen)) continue;
          candidates.push({ el, type: hint.type, score: hint.score, reason: `class matches ${hint.type}` });
          seen.add(el);
          break;
        }
      }
    }
  }

  function detectForms(doc, candidates, seen) {
    for (const el of queryAll(doc, 'div, section')) {
      if (seen.has(el) || isExcluded(el) || ancestorsSeen(el, seen)) continue;
      const inputs = el.querySelectorAll('input:not([type="hidden"]), textarea, select');
      const submits = el.querySelectorAll('button, input[type="submit"]');
      // Tight upper bound — big wrappers like `<body>` have dozens of inputs across
      // unrelated forms and shouldn't be treated as a single form.
      if (inputs.length >= 2 && inputs.length <= 12 && submits.length >= 1 && submits.length <= 4) {
        candidates.push({ el, type: TYPE.FORM, score: 65, reason: `${inputs.length} inputs` });
        seen.add(el);
      }
    }
  }

  // 3+ siblings with same tag+class signature → parent is a list/grid
  function detectSiblingClusters(doc, candidates, seen) {
    for (const parent of queryAll(doc, '*')) {
      if (isExcluded(parent)) continue;
      const kids = parent.children;
      if (!kids || kids.length < 3) continue;
      // Parent-tag sanity: lists/grids aren't rendered by <html>, <head>, <tr>, <colgroup>, etc.
      if (['HTML', 'HEAD', 'BODY', 'COLGROUP', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'SELECT', 'DATALIST'].includes(parent.tagName)) continue;

      const sigCount = {};
      for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        if (isExcluded(kid)) continue;
        const sig = childSignature(kid);
        sigCount[sig] = (sigCount[sig] || 0) + 1;
      }
      let top = null, topCount = 0;
      for (const [sig, count] of Object.entries(sigCount)) {
        if (count > topCount) { top = sig; topCount = count; }
      }
      if (!top || topCount < 3) continue;

      // Require matched siblings to have real content (not empty leaves)
      const matchingKids = Array.from(kids).filter(k => !isExcluded(k) && childSignature(k) === top);
      const allLeafless = matchingKids.every(k => (k.children?.length || 0) === 0 && !(k.textContent || '').trim());
      if (allLeafless) continue;

      if (seen.has(parent) || ancestorsSeen(parent, seen)) continue;

      // Infer list vs grid from layout if available
      let type = TYPE.LIST;
      if (hasLayoutInfo(parent) && parent.ownerDocument.defaultView) {
        try {
          const cs = parent.ownerDocument.defaultView.getComputedStyle(parent);
          if (cs.display === 'grid' || cs.display === 'inline-grid') type = TYPE.GRID;
          else if (cs.display === 'flex' && cs.flexWrap === 'wrap') type = TYPE.GRID;
        } catch {}
      }
      candidates.push({
        el: parent, type, score: 60 + Math.min(topCount * 2, 20),
        reason: `${topCount} similar children`, clusterCount: topCount, clusterSig: top
      });
      seen.add(parent);
    }
  }

  function detectHero(doc, candidates, seen) {
    // A hero is typically a top-of-page section with a big heading and a CTA.
    const body = doc.body;
    if (!body) return;
    const topRow = Array.from(body.children).slice(0, 5);
    for (const el of topRow) {
      if (seen.has(el)) continue;
      const hasHeading = el.querySelector('h1, h2');
      const hasCta = el.querySelector('button, a.btn, [role="button"], a[class*="btn"]');
      if (hasHeading && hasCta) {
        candidates.push({ el, type: TYPE.HERO, score: 70, reason: 'heading+CTA top of page' });
        seen.add(el);
      }
    }
  }

  // =====================================================================
  // Deduplication + filtering
  // =====================================================================

  // Type tiers:
  //   SCAFFOLD  — page-level wrappers (<main>, <section>). Get dropped when they
  //               contain a more specific component so we surface the useful one.
  //   DOMINANT  — first-class components that survive even inside scaffolds,
  //               but dedup against themselves (no <nav> inside <nav>).
  //   LEAF      — small primitives (button, input) that always survive,
  //               even inside other components.
  const SCAFFOLD_TYPES = new Set([TYPE.SECTION]);
  const DOMINANT_TYPES = new Set([
    TYPE.NAV, TYPE.HEADER, TYPE.FOOTER, TYPE.FORM, TYPE.MODAL,
    TYPE.TABLE, TYPE.HERO, TYPE.CARD, TYPE.LIST, TYPE.GRID
  ]);
  const LEAF_TYPES = new Set([TYPE.BUTTON, TYPE.INPUT, TYPE.BADGE]);

  function filterNested(candidates) {
    const sorted = [...candidates].sort((a, b) => depth(a.el) - depth(b.el));
    const kept = [];

    // Pass 1: drop dominant-inside-same-dominant (nav inside nav, form inside form)
    for (const c of sorted) {
      if (LEAF_TYPES.has(c.type)) { kept.push(c); continue; }

      let covered = false;
      for (const k of kept) {
        if (k.el === c.el || !k.el.contains(c.el)) continue;
        if (DOMINANT_TYPES.has(k.type) && k.type === c.type) { covered = true; break; }
      }
      if (!covered) kept.push(c);
    }

    // Pass 2: drop scaffolds that contain a dominant or another scaffold
    return kept.filter(c => {
      if (!SCAFFOLD_TYPES.has(c.type)) return true;
      for (const other of kept) {
        if (other === c) continue;
        if (!c.el.contains(other.el)) continue;
        if (DOMINANT_TYPES.has(other.type) || SCAFFOLD_TYPES.has(other.type)) return false;
      }
      return true;
    });
  }

  function depth(el) {
    let d = 0, p = el;
    while (p && p.parentElement) { d++; p = p.parentElement; }
    return d;
  }

  function filterVisible(candidates) {
    // Only filter in browser context where layout info is real
    if (candidates.length === 0 || !hasLayoutInfo(candidates[0].el)) return candidates;
    return candidates.filter(c => isVisibleInBrowser(c.el));
  }

  // =====================================================================
  // Public API
  // =====================================================================

  function scanPage(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('scanPage: no document');

    const candidates = [];
    const seen = new Set();

    // Priority order — earlier wins when dedup happens
    detectByTagAndRole(doc, candidates, seen);
    detectForms(doc, candidates, seen);
    detectSiblingClusters(doc, candidates, seen);
    detectByClassHints(doc, candidates, seen);
    detectButtons(doc, candidates, seen);
    detectHero(doc, candidates, seen);

    let filtered = filterVisible(filterNested(candidates));

    // Cap: return at most N per type, M overall, preferring highest score.
    filtered.sort((a, b) => b.score - a.score);
    const PER_TYPE = 15;
    const OVERALL = 80;
    const typeCount = {};
    filtered = filtered.filter(c => {
      typeCount[c.type] = (typeCount[c.type] || 0) + 1;
      return typeCount[c.type] <= PER_TYPE;
    }).slice(0, OVERALL);

    const groups = {};
    for (const c of filtered) (groups[c.type] = groups[c.type] || []).push(c);
    for (const type in groups) groups[type].sort((a, b) => b.score - a.score);

    return { candidates: filtered, groups };
  }

  // =====================================================================
  // Export
  // =====================================================================
  const api = { scanPage, TYPE, _internal: { childSignature, normalizeClassToken, filterNested } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.__easyDivDetector = api;
})(typeof window !== 'undefined' ? window : globalThis);
