let inspectorActive = false;
let highlightBox = null;

// --- TAILWIND & CSS ENGINES ---
const TW_MAP = {
  "display": { "block": "block", "inline-block": "inline-block", "flex": "flex", "grid": "grid", "none": "hidden" },
  "position": { "absolute": "absolute", "relative": "relative", "fixed": "fixed" },
  "flex-direction": { "column": "flex-col", "row": "flex-row" },
  "flex-wrap": { "wrap": "flex-wrap", "nowrap": "flex-nowrap" },
  "align-items": { "center": "items-center", "flex-start": "items-start", "flex-end": "items-end", "baseline": "items-baseline" },
  "justify-content": { "center": "justify-center", "space-between": "justify-between", "flex-start": "justify-start", "flex-end": "justify-end" },
  "text-align": { "center": "text-center", "left": "text-left", "right": "text-right" },
  "font-weight": { "700": "font-bold", "600": "font-semibold", "500": "font-medium", "400": "font-normal" },
  "cursor": { "pointer": "cursor-pointer", "not-allowed": "cursor-not-allowed" }
};

const TW_SPACING_MAP = {
  '0px': '0', '1px': 'px', '2px': '0.5', '4px': '1', '6px': '1.5', '8px': '2',
  '10px': '2.5', '12px': '3', '14px': '3.5', '16px': '4', '20px': '5', '24px': '6',
  '28px': '7', '32px': '8', '36px': '9', '40px': '10', '44px': '11', '48px': '12',
  '56px': '14', '64px': '16', '80px': '20', '96px': '24', '112px': '28', '128px': '32',
  '144px': '36', '160px': '40', '176px': '44', '192px': '48', '208px': '52', '224px': '56',
  '240px': '60', '256px': '64', '288px': '72', '320px': '80', '384px': '96'
};

// Parse map into a sorted array of numbers for nearest neighbor search
const TW_VALUES = Object.keys(TW_SPACING_MAP)
  .map(k => parseFloat(k))
  .sort((a, b) => a - b);

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
    if (diff <= minDiff) { // Use <= to prefer larger value on ties (round up)
      minDiff = diff;
      closest = TW_VALUES[i];
    }
  }

  // Snap if within reasonable distance (e.g. 2.5px)
  // 17px -> 16px (diff 1) -> OK
  // 15px -> 16px (diff 1) -> OK
  // 2.4px -> 2px  (diff 0.4) -> OK 
  let twValue;
  if (minDiff <= 2.5) {
    twValue = TW_SPACING_MAP[`${closest}px`];
  } else {
    twValue = `[${absPx}px]`;
  }

  return isNegative ? `-${twValue}` : twValue;
}

function normalizeColor(color) {
  if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') return null;

  // Handle RGBA with alpha
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    const [_, r, g, b, a] = rgbaMatch;
    // If alpha is undefined or 1, it's solid
    if (!a || parseFloat(a) >= 1) {
      return `[rgb(${r},${g},${b})]`;
    } else {
      // Convert alpha to percentage for Tailwind opacity modifier
      // .bg-blue-500/50
      // We can't easily map distinct RGB to a color name without a massive library.
      // So use arbitrary value with opacity: bg-[rgba(r,g,b,a)]
      return `[${color.replace(/\s/g, '')}]`;
    }
  }
  return `[${color.replace(/\s/g, '')}]`;
}

function generateTailwindClasses(computed, element) {
  let classes = [];

  // FILTER DEFAULTS: Only output if it deviates from browser default
  const tagName = element.tagName.toLowerCase();

  // 1. Map keywords with Bloat Filtering
  const isFlex = computed.display === 'flex' || computed.display === 'inline-flex';
  const isGrid = computed.display === 'grid' || computed.display === 'inline-grid';

  for (const [prop, map] of Object.entries(TW_MAP)) {
    const val = computed.getPropertyValue(prop);

    // Skip defaults
    if (prop === 'display' && val === 'block' && tagName === 'div') continue;
    if (prop === 'display' && val === 'inline' && tagName === 'span') continue;
    if (prop === 'position' && val === 'static') continue;
    if (prop === 'flex-direction' && val === 'row' && isFlex) continue; // Row is default for flex
    if (prop === 'flex-wrap' && val === 'nowrap') continue;
    if (prop === 'align-items' && val === 'normal') continue;
    if (prop === 'justify-content' && val === 'normal') continue;

    if (map[val]) classes.push(map[val]);
  }

  // 2. Map dimensions & colors with Smart Conversion
  const spacingProps = [
    { css: 'width', tw: 'w' }, { css: 'height', tw: 'h' },
    { css: 'min-width', tw: 'min-w' }, { css: 'min-height', tw: 'min-h' },
    { css: 'margin-top', tw: 'mt' }, { css: 'margin-right', tw: 'mr' }, { css: 'margin-bottom', tw: 'mb' }, { css: 'margin-left', tw: 'ml' },
    { css: 'padding-top', tw: 'pt' }, { css: 'padding-right', tw: 'pr' }, { css: 'padding-bottom', tw: 'pb' }, { css: 'padding-left', tw: 'pl' },
    { css: 'top', tw: 'top' }, { css: 'left', tw: 'left' }, { css: 'right', tw: 'right' }, { css: 'bottom', tw: 'bottom' },
    { css: 'gap', tw: 'gap' }, { css: 'border-radius', tw: 'rounded' }
  ];

  spacingProps.forEach(({ css, tw }) => {
    let val = computed.getPropertyValue(css);

    // Check Inline Style for Percentages first (Structural Edge Case)
    // computed style always returns pixels for percentages, destroying responsiveness.
    if (element.style && element.style[css] && element.style[css].includes('%')) {
      const pct = element.style[css];
      if (pct === '50%') { classes.push(`${tw}-1/2`); return; }
      if (pct === '33.33%') { classes.push(`${tw}-1/3`); return; }
      if (pct === '66.66%') { classes.push(`${tw}-2/3`); return; }
      if (pct === '25%') { classes.push(`${tw}-1/4`); return; }
      if (pct === '75%') { classes.push(`${tw}-3/4`); return; }
      if (pct === '100%') { classes.push(`${tw}-full`); return; }
      // Fallback to arbitrary percentage
      classes.push(`${tw}-[${pct}]`);
      return;
    }

    if (!val || val === 'auto' || val === '0px' || val === 'none' || val === 'static') return;

    // Convert to Tailwind scale
    const twValue = pxToTw(val);
    if (twValue) classes.push(`${tw}-${twValue}`);
  });

  // Z-Index (Structural)
  const zIndex = computed.getPropertyValue('z-index');
  if (zIndex && zIndex !== 'auto') {
    const zInt = parseInt(zIndex);
    if (zInt >= 0 && zInt <= 50 && zInt % 10 === 0) classes.push(`z-${zInt}`);
    else classes.push(`z-[${zIndex}]`);
  }

  // Fonts
  const fontSize = computed.getPropertyValue('font-size');
  if (fontSize) {
    if (fontSize === '14px') classes.push('text-sm');
    else if (fontSize === '16px') classes.push('text-base');
    else if (fontSize === '18px') classes.push('text-lg');
    else if (fontSize === '20px') classes.push('text-xl');
    else if (fontSize === '12px') classes.push('text-xs');
    else if (fontSize === '24px') classes.push('text-2xl');
    else if (fontSize === '30px') classes.push('text-3xl');
    else if (fontSize === '36px') classes.push('text-4xl');
    else {
      const twVal = pxToTw(fontSize);
      classes.push(twVal.startsWith('[') ? `text-[${fontSize}]` : `text-[${fontSize}]`); // Font size usually specific
    }
  }

  // Colors (Smart Handling)
  const bg = computed.getPropertyValue('background-color');
  const bgTw = normalizeColor(bg);
  if (bgTw) classes.push(`bg-${bgTw}`);

  // Gradients (Background Image)
  const bgImg = computed.getPropertyValue('background-image');
  if (bgImg && bgImg !== 'none' && bgImg.includes('gradient')) {
    // Gradients are too complex to map to from-x to-y accurately without AI
    // Use arbitrary value
    classes.push(`bg-[${bgImg.replace(/\s+/g, '')}]`);
  }

  const col = computed.getPropertyValue('color');
  const colTw = normalizeColor(col);
  // Only output color if it's not inherited/black (reduce bloat)? 
  // No, text color is widely inherited so explicit is safer, but maybe check if parent has same color?
  // For now, explicit is better for copy/paste utility.
  if (colTw) classes.push(`text-${colTw}`);

  return classes.join(' ');
}

// --- INLINE STYLE GENERATION (UNIVERSAL) ---
function generateInlineStyles(computed) {
  const props = [
    // Layout
    'display', 'position', 'top', 'left', 'right', 'bottom', 'z-index',
    'overflow', 'overflow-x', 'overflow-y',

    // Flex/Grid
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
    'flex-grow', 'flex-shrink', 'flex-basis',

    // Dimensions & Spacing
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',

    // Typography
    'font-family', 'font-size', 'font-weight', 'line-height', 'text-align',
    'color', 'text-decoration', 'text-transform', 'letter-spacing',

    // Appearance
    'background-color', 'background-image', 'background-size', 'background-position',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-radius', 'box-shadow', 'opacity', 'visibility'
  ];

  let styleString = '';

  props.forEach(prop => {
    const val = computed.getPropertyValue(prop);
    // Filter default/empty values to keep size down
    if (val && val !== 'auto' && val !== 'normal' && val !== 'none' &&
      val !== '0px' && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent' &&
      val !== 'static' && val !== 'visible') {
      styleString += `${prop}: ${val}; `;
    }
  });

  return styleString.trim();
}

// --- LOTTIE DETECTION ---
function detectLottie(element) {
  // Check for Lottie indicators
  const hasLottieId = element.querySelector('[id*="__lottie_element"]') !== null;
  const hasLottiePlayer = element.querySelector('lottie-player, dotlottie-player') !== null;
  const hasSvgMasks = element.querySelectorAll('svg mask').length > 3; // Lottie uses many masks
  const hasBodymovinClass = element.querySelector('[class*="bodymovin"]') !== null;

  return hasLottieId || hasLottiePlayer || hasSvgMasks || hasBodymovinClass;
}

function extractLottieData() {
  // Try to find Lottie animation data in global scope
  const lottieData = [];

  // Check for lottie global objects
  if (typeof window.lottie !== 'undefined') {
    try {
      const animations = window.lottie.getRegisteredAnimations?.() || [];
      animations.forEach((anim, i) => {
        if (anim.animationData) {
          lottieData.push({
            index: i,
            data: JSON.stringify(anim.animationData).substring(0, 50000) // Limit size
          });
        }
      });
    } catch (e) {
      console.log('EasyDiv: Could not extract Lottie data', e);
    }
  }

  // Check for bodymovin
  if (typeof window.bodymovin !== 'undefined') {
    try {
      const animations = window.bodymovin.getRegisteredAnimations?.() || [];
      animations.forEach((anim, i) => {
        if (anim.animationData) {
          lottieData.push({
            index: i,
            data: JSON.stringify(anim.animationData).substring(0, 50000)
          });
        }
      });
    } catch (e) {
      console.log('EasyDiv: Could not extract bodymovin data', e);
    }
  }

  return lottieData;
}

// --- CLONER ---
function freezeElement(originalEl) {
  if (originalEl.checkVisibility && !originalEl.checkVisibility()) return null;
  if (['SCRIPT', 'NOSCRIPT', 'STYLE', 'IFRAME'].includes(originalEl.tagName)) return null;

  // 1. Deep clone first
  const clone = originalEl.cloneNode(true);

  // 2. Traverse both trees in parallel to extract computed styles 
  // We do this to capture Tailwind classes without baking inline styles
  const originalWalker = document.createTreeWalker(originalEl, NodeFilter.SHOW_ELEMENT);
  const cloneWalker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);

  let currentOrig = originalWalker.currentNode;
  let currentClone = cloneWalker.currentNode;

  while (currentOrig && currentClone) {
    // Generate Tailwind classes
    const computed = window.getComputedStyle(currentOrig);
    const twClasses = generateTailwindClasses(computed);
    if (twClasses) {
      currentClone.setAttribute('data-tw', twClasses);
    }

    // Generate Inline Styles (Universal)
    const inlineStyles = generateInlineStyles(computed);
    if (inlineStyles) {
      currentClone.setAttribute('data-inline-style', inlineStyles);
    }

    // Fix images
    if (currentClone.tagName === 'IMG') {
      currentClone.src = currentOrig.currentSrc || currentOrig.src;
      currentClone.removeAttribute('srcset');
      currentClone.removeAttribute('loading');
    }

    // Fix Canvas (special case)
    if (currentOrig.tagName === 'CANVAS') {
      const width = currentOrig.width;
      const height = currentOrig.height;
      // Replace canvas with div in the clone
      const placeholder = document.createElement("div");
      placeholder.setAttribute('data-is-canvas', 'true');
      placeholder.style.cssText = `width:${width}px;height:${height}px;background:#222;display:flex;align-items:center;justify-content:center;color:#666;border:1px dashed #444;`;
      placeholder.textContent = 'CANVAS';

      // We need to replace currentClone in the tree, but TreeWalker is finicky about replacements.
      // It's safer to just modify the output clone after.
      // Or simple hack: change currentClone to a div tag? No.
      // Let's just set innerHTML of parent? No.
      // Simpler: Just mark it and let post-processing handle if needed?
      // Let's apply styles to the canvas element itself (it behaves like a block often) and clear its context content?
      // Actually, just leaving it as canvas with inline styles might work for layout, but it will be blank.
      currentClone.setAttribute('data-width', width);
      currentClone.setAttribute('data-height', height);
    }

    // Move to next
    currentOrig = originalWalker.nextNode();
    currentClone = cloneWalker.nextNode();
  }

  // 3. Clean up the clone
  // Remove scripts but KEEP style tags (they contain component-specific CSS)
  clone.querySelectorAll('script, noscript').forEach(el => el.remove());

  // Clean attributes
  const allClones = clone.querySelectorAll('*');
  allClones.forEach(el => {
    // Remove inline handlers
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith('on') || (attr.name.startsWith('data-') && attr.name !== 'data-tw')) {
        el.removeAttribute(attr.name);
      }
    });
    // Remove IDs
    el.removeAttribute('id');
  });
  clone.removeAttribute('id');

  // Fix links
  clone.querySelectorAll('a').forEach(a => {
    try { a.href = new URL(a.getAttribute('href'), document.baseURI).href; } catch (e) { }
  });

  return clone;
}

// --- UI & EVENT HANDLERS ---
function createHighlighter() {
  if (document.getElementById("easydiv-highlighter")) return;
  highlightBox = document.createElement("div");
  highlightBox.id = "easydiv-highlighter";
  Object.assign(highlightBox.style, {
    position: "absolute",
    border: "2px solid #8b5cf6",
    backgroundColor: "rgba(139, 92, 246, 0.15)",
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

  const frozenNode = freezeElement(el);
  if (!frozenNode) return;

  const frozenHTML = frozenNode.outerHTML;

  // Also collect the page's stylesheets for reference
  const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => link.href)
    .filter(href => href && !href.includes('chrome-extension://'));

  // Detect Lottie animations
  const hasLottie = detectLottie(el);
  const lottieData = hasLottie ? extractLottieData() : [];

  const newItem = {
    id: Date.now(),
    timestamp: new Date().toLocaleTimeString(),
    source: window.location.hostname,
    url: window.location.href,
    html: frozenHTML,
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
  const frozenNode = freezeElement(el);
  if (!frozenNode) return;

  const html = frozenNode.outerHTML;
  navigator.clipboard.writeText(html).then(() => {
    showToast("Copied to clipboard!");
  });
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
  // We don't auto-copy to clipboard anymore on click, we let them choose in the dock
  // or maybe we do? Let's keep it simple and just save to dock.
  // copyElementToClipboard(e.target); 
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
    if (highlightBox) {
      highlightBox.style.display = "none";
    }
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

// Message Bus
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "toggleInspection") {
    toggleInspection(request.isActive);
    sendResponse({ success: true });
  }

  if (request.action === "copyFullPage") {
    copyFullPage()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('EasyDiv: Copy failed', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.action === "getRawCode") {
    // Only respond from the TOP frame to avoid capturing iframe content (like Lovable preview)
    if (window !== window.top) {
      // Don't respond from iframes - let the top frame handle it
      return false;
    }

    try {
      // Clone the document to avoid modifying the actual page
      const clonedDoc = document.documentElement.cloneNode(true);

      // Remove EasyDiv elements (highlighter, toast) so they don't appear in preview
      clonedDoc.querySelectorAll('#easydiv-highlighter, #easydiv-toast').forEach(el => el.remove());

      const html = clonedDoc.outerHTML;
      sendResponse({
        success: true,
        html: html,
        url: window.location.href
      });
    } catch (e) {
      console.error('EasyDiv: Failed to get raw code', e);
      sendResponse({
        success: false,
        error: e.message
      });
    }
    return true;
  }

  if (request.action === "getStatus") {
    sendResponse({ success: true, isActive: inspectorActive });
  }

  if (request.action === "ping") {
    // Only respond from top frame
    if (window === window.top) {
      sendResponse({ status: "alive" });
    }
  }

  return true;
});

function showToast(msg) {
  const existingToast = document.getElementById("easydiv-toast");
  if (existingToast) existingToast.remove();

  const t = document.createElement("div");
  t.id = "easydiv-toast";
  t.innerText = msg;
  Object.assign(t.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    background: "linear-gradient(135deg, #18181b 0%, #27272a 100%)",
    color: "#e4e4e7",
    border: "1px solid #3f3f46",
    padding: "12px 24px",
    borderRadius: "8px",
    zIndex: "2147483647",
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "14px",
    fontWeight: "500"
  });

  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
