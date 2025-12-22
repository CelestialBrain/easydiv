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

function generateTailwindClasses(computed) {
  let classes = [];

  // 1. Map keywords
  for (const [prop, map] of Object.entries(TW_MAP)) {
    const val = computed.getPropertyValue(prop);
    if (map[val]) classes.push(map[val]);
  }

  // 2. Map dimensions & colors using arbitrary values (JIT)
  // This ensures pixel-perfect copying without massive config files
  const props = [
    { css: 'width', tw: 'w' }, { css: 'height', tw: 'h' },
    { css: 'min-width', tw: 'min-w' }, { css: 'min-height', tw: 'min-h' },
    { css: 'margin-top', tw: 'mt' }, { css: 'margin-right', tw: 'mr' }, { css: 'margin-bottom', tw: 'mb' }, { css: 'margin-left', tw: 'ml' },
    { css: 'padding-top', tw: 'pt' }, { css: 'padding-right', tw: 'pr' }, { css: 'padding-bottom', tw: 'pb' }, { css: 'padding-left', tw: 'pl' },
    { css: 'font-size', tw: 'text' }, { css: 'line-height', tw: 'leading' },
    { css: 'border-radius', tw: 'rounded' }, { css: 'z-index', tw: 'z' },
    { css: 'top', tw: 'top' }, { css: 'left', tw: 'left' }
  ];

  props.forEach(({ css, tw }) => {
    let val = computed.getPropertyValue(css);
    if (!val || val === 'auto' || val === '0px' || val === 'none' || val === 'static' || val === 'rgba(0, 0, 0, 0)') return;
    classes.push(`${tw}-[${val}]`);
  });

  // Colors
  const bg = computed.getPropertyValue('background-color');
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') classes.push(`bg-[${bg.replace(/\s/g, '')}]`);

  const col = computed.getPropertyValue('color');
  if (col) classes.push(`text-[${col.replace(/\s/g, '')}]`);

  return classes.join(' ');
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

  const newItem = {
    id: Date.now(),
    timestamp: new Date().toLocaleTimeString(),
    source: window.location.hostname,
    url: window.location.href,
    html: frozenHTML,
    stylesheets: stylesheets
  };

  chrome.storage.local.get({ dockItems: [] }, (result) => {
    const items = result.dockItems;
    items.unshift(newItem);
    if (items.length > 20) items.pop();

    chrome.storage.local.set({ dockItems: items }, () => {
      showToast("Captured! (Saved to Dock)");
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
    try {
      // For very large pages, this might be slow
      const html = document.documentElement.outerHTML;
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
    sendResponse({ status: "alive" });
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
