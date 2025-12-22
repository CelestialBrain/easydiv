let inspectorActive = false;
let highlightBox = null;

// --- 1. TAILWIND MAPPING ENGINE ---
// Maps standard CSS properties to Tailwind utility logic
const TW_MAP = {
  "display": { "block": "block", "inline-block": "inline-block", "flex": "flex", "grid": "grid", "none": "hidden", "inline": "inline", "inline-flex": "inline-flex" },
  "position": { "absolute": "absolute", "relative": "relative", "fixed": "fixed", "sticky": "sticky", "static": "static" },
  "flex-direction": { "column": "flex-col", "row": "flex-row", "column-reverse": "flex-col-reverse", "row-reverse": "flex-row-reverse" },
  "flex-wrap": { "wrap": "flex-wrap", "nowrap": "flex-nowrap", "wrap-reverse": "flex-wrap-reverse" },
  "align-items": { "center": "items-center", "flex-start": "items-start", "flex-end": "items-end", "baseline": "items-baseline", "stretch": "items-stretch" },
  "justify-content": { "center": "justify-center", "space-between": "justify-between", "flex-start": "justify-start", "flex-end": "justify-end", "space-around": "justify-around", "space-evenly": "justify-evenly" },
  "font-weight": { "700": "font-bold", "600": "font-semibold", "500": "font-medium", "400": "font-normal", "300": "font-light", "200": "font-extralight", "100": "font-thin", "800": "font-extrabold", "900": "font-black" },
  "text-align": { "center": "text-center", "left": "text-left", "right": "text-right", "justify": "text-justify" },
  "cursor": { "pointer": "cursor-pointer", "not-allowed": "cursor-not-allowed", "wait": "cursor-wait", "text": "cursor-text", "move": "cursor-move", "grab": "cursor-grab" },
  "overflow": { "hidden": "overflow-hidden", "auto": "overflow-auto", "scroll": "overflow-scroll", "visible": "overflow-visible" },
  "overflow-x": { "hidden": "overflow-x-hidden", "auto": "overflow-x-auto", "scroll": "overflow-x-scroll" },
  "overflow-y": { "hidden": "overflow-y-hidden", "auto": "overflow-y-auto", "scroll": "overflow-y-scroll" },
  "text-decoration-line": { "underline": "underline", "line-through": "line-through", "none": "no-underline" },
  "text-transform": { "uppercase": "uppercase", "lowercase": "lowercase", "capitalize": "capitalize", "none": "normal-case" },
  "white-space": { "nowrap": "whitespace-nowrap", "pre": "whitespace-pre", "pre-wrap": "whitespace-pre-wrap", "pre-line": "whitespace-pre-line" },
  "word-break": { "break-all": "break-all", "break-word": "break-words" },
  "visibility": { "hidden": "invisible", "visible": "visible" },
  "opacity": { "0": "opacity-0", "1": "opacity-100" },
  "pointer-events": { "none": "pointer-events-none", "auto": "pointer-events-auto" },
  "user-select": { "none": "select-none", "text": "select-text", "all": "select-all", "auto": "select-auto" },
  "list-style-type": { "none": "list-none", "disc": "list-disc", "decimal": "list-decimal" },
  "object-fit": { "contain": "object-contain", "cover": "object-cover", "fill": "object-fill", "none": "object-none", "scale-down": "object-scale-down" }
};

// Converts computed CSS values into Tailwind Arbitrary Values (e.g., w-[20px])
function styleToTailwind(computed) {
  let classes = [];

  // A. Keyword Mapping
  for (const [prop, map] of Object.entries(TW_MAP)) {
    const val = computed.getPropertyValue(prop);
    if (map[val]) classes.push(map[val]);
  }

  // B. Dimensional Mapping (Arbitrary Values)
  // We use arbitrary values (e.g., w-[350px]) for 1:1 pixel perfection
  const dims = [
    { css: 'width', tw: 'w' }, 
    { css: 'height', tw: 'h' },
    { css: 'min-width', tw: 'min-w' },
    { css: 'min-height', tw: 'min-h' },
    { css: 'max-width', tw: 'max-w' },
    { css: 'max-height', tw: 'max-h' },
    { css: 'margin-top', tw: 'mt' }, 
    { css: 'margin-bottom', tw: 'mb' },
    { css: 'margin-left', tw: 'ml' }, 
    { css: 'margin-right', tw: 'mr' },
    { css: 'padding-top', tw: 'pt' }, 
    { css: 'padding-bottom', tw: 'pb' },
    { css: 'padding-left', tw: 'pl' }, 
    { css: 'padding-right', tw: 'pr' },
    { css: 'font-size', tw: 'text' }, 
    { css: 'line-height', tw: 'leading' },
    { css: 'letter-spacing', tw: 'tracking' },
    { css: 'border-radius', tw: 'rounded' },
    { css: 'border-top-left-radius', tw: 'rounded-tl' },
    { css: 'border-top-right-radius', tw: 'rounded-tr' },
    { css: 'border-bottom-left-radius', tw: 'rounded-bl' },
    { css: 'border-bottom-right-radius', tw: 'rounded-br' },
    { css: 'gap', tw: 'gap' },
    { css: 'row-gap', tw: 'gap-y' },
    { css: 'column-gap', tw: 'gap-x' },
    { css: 'z-index', tw: 'z' },
    { css: 'top', tw: 'top' },
    { css: 'bottom', tw: 'bottom' },
    { css: 'left', tw: 'left' },
    { css: 'right', tw: 'right' },
    { css: 'flex-grow', tw: 'grow' },
    { css: 'flex-shrink', tw: 'shrink' },
    { css: 'order', tw: 'order' }
  ];

  dims.forEach(({ css, tw }) => {
    let val = computed.getPropertyValue(css);
    // Clean up '0px' values
    if (val === '0px' || val === '0') return; 
    // Skip auto, normal, and none values
    if (val && val !== 'auto' && val !== 'normal' && val !== 'none') {
      classes.push(`${tw}-[${val}]`);
    }
  });

  // C. Colors (Background & Text)
  const bg = computed.getPropertyValue('background-color');
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    classes.push(`bg-[${bg.replace(/\s/g, '')}]`); 
  }

  const col = computed.getPropertyValue('color');
  if (col) {
    classes.push(`text-[${col.replace(/\s/g, '')}]`);
  }

  // D. Borders
  const borderWidth = computed.getPropertyValue('border-width');
  if (borderWidth && borderWidth !== '0px') {
    classes.push(`border-[${borderWidth}]`);
    const borderColor = computed.getPropertyValue('border-color');
    if (borderColor) {
      classes.push(`border-[${borderColor.replace(/\s/g, '')}]`);
    }
    const borderStyle = computed.getPropertyValue('border-style');
    if (borderStyle && borderStyle !== 'none' && borderStyle !== 'solid') {
      classes.push(`border-${borderStyle}`);
    }
  }

  // E. Box Shadow
  const boxShadow = computed.getPropertyValue('box-shadow');
  if (boxShadow && boxShadow !== 'none') {
    classes.push(`shadow-[${boxShadow.replace(/\s/g, '_')}]`);
  }

  // F. Opacity (if not 1)
  const opacity = computed.getPropertyValue('opacity');
  if (opacity && opacity !== '1') {
    classes.push(`opacity-[${opacity}]`);
  }

  // G. Background Image / Gradient
  const bgImage = computed.getPropertyValue('background-image');
  if (bgImage && bgImage !== 'none') {
    // For gradients, we can try to preserve them
    if (bgImage.includes('gradient')) {
      classes.push(`bg-[${bgImage.replace(/\s/g, '_')}]`);
    }
  }

  // H. Transition
  const transition = computed.getPropertyValue('transition');
  if (transition && transition !== 'none' && transition !== 'all 0s ease 0s') {
    const duration = computed.getPropertyValue('transition-duration');
    if (duration && duration !== '0s') {
      classes.push(`duration-[${duration}]`);
    }
  }

  return classes.join(" ");
}

// --- 2. DEEP CLONER (Smart & Safe) ---
function freezeElement(originalEl) {
  // A. Safety Check: If element is invisible, don't bother (prevents bloat)
  if (originalEl.checkVisibility && !originalEl.checkVisibility()) {
    return document.createComment(" Hidden Element Ignored ");
  }

  // B. Canvas/Animation Handling
  if (originalEl.tagName === "CANVAS") {
    // We cannot steal canvas context. Return a placeholder.
    const placeholder = document.createElement("div");
    placeholder.className = "bg-gray-800 flex items-center justify-center border border-dashed border-gray-600 text-gray-400 text-xs p-4";
    placeholder.innerText = "⚡ Canvas Animation Placeholder";
    // Try to match size
    placeholder.style.width = originalEl.width + "px";
    placeholder.style.height = originalEl.height + "px";
    return placeholder;
  }

  // C. Handle SVG elements
  if (originalEl.tagName === "SVG" || originalEl instanceof SVGElement) {
    return originalEl.cloneNode(true);
  }

  // D. Handle script and style tags - skip them
  if (originalEl.tagName === "SCRIPT" || originalEl.tagName === "STYLE" || originalEl.tagName === "NOSCRIPT") {
    return document.createComment(` ${originalEl.tagName} removed `);
  }

  // E. Clone the node
  const clone = originalEl.cloneNode(false); // Shallow clone first

  // F. Convert Styles to Tailwind
  const computed = window.getComputedStyle(originalEl);
  const tailwindClasses = styleToTailwind(computed);
  
  // G. Add Classes
  if (tailwindClasses) {
    // Overwrite existing classes to ensure we only have our stolen styles
    clone.setAttribute('class', tailwindClasses);
  }
  
  // H. Asset Handling (Fix broken images)
  if (originalEl.tagName === "IMG") {
    clone.src = originalEl.src; // Browser automatically makes this absolute
    clone.alt = originalEl.alt || "";
    // Remove srcset to avoid issues
    clone.removeAttribute("srcset");
  }

  // I. Handle links - make absolute
  if (originalEl.tagName === "A") {
    clone.href = originalEl.href; // Browser automatically makes this absolute
  }

  // J. Handle video/audio with poster/src
  if (originalEl.tagName === "VIDEO" || originalEl.tagName === "AUDIO") {
    if (originalEl.poster) clone.poster = originalEl.poster;
    if (originalEl.src) clone.src = originalEl.src;
  }

  // K. Preserve text content for text elements
  if (originalEl.childNodes.length === 1 && originalEl.childNodes[0].nodeType === Node.TEXT_NODE) {
    clone.textContent = originalEl.textContent;
  }

  // L. Remove Junk Attributes
  const junkAttrs = ['style', 'id', 'data-testid', 'data-reactid', 'data-v-', 'ng-', 'data-controller', 'data-action'];
  junkAttrs.forEach(attr => {
    if (attr.endsWith('-')) {
      // Remove all attributes starting with this prefix
      Array.from(clone.attributes || []).forEach(a => {
        if (a.name.startsWith(attr)) {
          clone.removeAttribute(a.name);
        }
      });
    } else {
      clone.removeAttribute(attr);
    }
  });

  // M. Recursion (Process Children)
  Array.from(originalEl.children).forEach(child => {
    const childClone = freezeElement(child);
    if (childClone && childClone.nodeType !== Node.COMMENT_NODE) {
      clone.appendChild(childClone);
    } else if (childClone && childClone.nodeType === Node.COMMENT_NODE) {
      // Optionally append comments or skip
      // clone.appendChild(childClone);
    }
  });

  return clone;
}

// --- 3. UI & EVENT HANDLERS ---
function createHighlighter() {
  if (document.getElementById("ds-highlighter")) return;
  highlightBox = document.createElement("div");
  highlightBox.id = "ds-highlighter";
  Object.assign(highlightBox.style, {
    position: "fixed",
    border: "2px solid #8b5cf6", // Purple to match DivMagic
    backgroundColor: "rgba(139, 92, 246, 0.15)",
    pointerEvents: "none",
    zIndex: "2147483647",
    borderRadius: "4px",
    transition: "all 0.05s ease",
    boxShadow: "0 0 0 1px rgba(139, 92, 246, 0.3)"
  });
  document.body.appendChild(highlightBox);
}

function highlight(el) {
  if (!highlightBox) createHighlighter();
  const rect = el.getBoundingClientRect();
  Object.assign(highlightBox.style, {
    top: rect.top + "px",
    left: rect.left + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    display: "block"
  });
}

function saveToDock(el) {
  // Prevent saving our own UI
  if (el.id === "ds-highlighter" || el.closest("#ds-highlighter")) return;

  // Run the Deep Freeze
  const frozenNode = freezeElement(el);
  const frozenHTML = frozenNode.outerHTML;
  
  const newItem = {
    id: Date.now(),
    timestamp: new Date().toLocaleTimeString(),
    source: window.location.hostname,
    html: frozenHTML // Now contains clean Tailwind classes!
  };

  chrome.storage.local.get({ dockItems: [] }, (result) => {
    const items = result.dockItems;
    items.unshift(newItem);
    if (items.length > 20) items.pop();
    
    chrome.storage.local.set({ dockItems: items }, () => {
      showToast("✨ Component captured with Tailwind!");
    });
  });
}

// Listeners
function onMouseMove(e) {
  if (!inspectorActive) return;
  // Ignore our own highlighter
  if (e.target.id === "ds-highlighter") return;
  highlight(e.target);
}

function onClick(e) {
  if (!inspectorActive) return;
  e.preventDefault();
  e.stopPropagation();
  saveToDock(e.target);
}

function onKeyDown(e) {
  // Press Escape to deactivate inspector
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
    showToast("🎯 Inspector active - click any element");
  } else {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = "";
    if (highlightBox) highlightBox.style.display = "none";
  }
}

// Message Bus
chrome.runtime.onMessage.addListener((req, sender, sendRes) => {
  if (req.action === "toggleInspection") {
    toggleInspection(req.isActive);
    sendRes({ success: true });
  }
  if (req.action === "getRawCode") {
    sendRes({ 
      success: true, 
      html: document.documentElement.outerHTML, 
      url: window.location.href 
    });
  }
  if (req.action === "getStatus") {
    sendRes({ 
      success: true, 
      isActive: inspectorActive 
    });
  }
  return true; // Keep message channel open for async response
});

function showToast(msg) {
  // Remove existing toast if any
  const existingToast = document.getElementById("ds-toast");
  if (existingToast) existingToast.remove();

  const t = document.createElement("div");
  t.id = "ds-toast";
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
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.2)", 
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "14px",
    fontWeight: "500",
    animation: "slideIn 0.3s ease"
  });

  // Add keyframe animation
  if (!document.getElementById("ds-toast-styles")) {
    const style = document.createElement("style");
    style.id = "ds-toast-styles";
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(t);
  
  setTimeout(() => {
    t.style.animation = "slideOut 0.3s ease";
    setTimeout(() => t.remove(), 300);
  }, 2200);
}
