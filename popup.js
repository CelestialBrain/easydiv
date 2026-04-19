document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-inspector");
    const copyBtn = document.getElementById("copy-full-page");
    const previewBtn = document.getElementById("preview-design");
    const clearBtn = document.getElementById("clear-dock");
    const scrapeBtn = document.getElementById("scrape-page");
    const categoryFilter = document.getElementById("category-filter");
    const status = document.getElementById("status-message");
    const dockList = document.getElementById("dock-list");
    const dockCount = document.getElementById("dock-count");

    let activeCategory = 'all'; // 'all' | TYPE name

    const optionsBtn = document.getElementById('open-options');
    if (optionsBtn) {
        optionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
            else chrome.tabs.create({ url: 'options.html' });
        });
    }
    const decompilerBtn = document.getElementById('open-decompiler');
    if (decompilerBtn) {
        decompilerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chrome.tabs.create({ url: 'decompiler.html' });
        });
    }

    const setStatus = (msg) => { status.textContent = msg; };

    // Get the active tab — works in both toolbar popup and DevTools panel contexts.
    // DevTools pages expose `chrome.devtools.inspectedWindow.tabId`; popups use
    // chrome.tabs.query. We normalize both to `{ id, url }`.
    function getActiveTab(cb) {
        if (typeof chrome !== 'undefined' && chrome.devtools && chrome.devtools.inspectedWindow) {
            const tabId = chrome.devtools.inspectedWindow.tabId;
            chrome.tabs.get(tabId, (tab) => cb(tab));
            return;
        }
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => cb(tabs[0]));
    }

    // Check state on load
    getActiveTab((tab) => {
        if (!tab || tab.url.startsWith("chrome://")) {
            setStatus("Cannot run on system pages");
            toggleBtn.disabled = true;
            copyBtn.disabled = true;
            previewBtn.disabled = true;
            return;
        }

        chrome.runtime.sendMessage(
            { action: "getInspectionState", tabId: tab.id },
            (res) => {
                if (res?.isActive) {
                    toggleBtn.textContent = "Deactivate Inspector";
                    toggleBtn.classList.add("active");
                }
            }
        );
    });

    function ensureContent(tabId, cb) {
        chrome.tabs.sendMessage(tabId, { action: "ping" }, () => {
            if (chrome.runtime.lastError) {
                chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] }, () => {
                    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
                        cb();
                    });
                });
            } else {
                cb();
            }
        });
    }

    toggleBtn.onclick = () => {
        getActiveTab((tab) => {
            ensureContent(tab.id, () => {
                chrome.runtime.sendMessage(
                    { action: "toggleInspection", tabId: tab.id },
                    (res) => {
                        if (res.isActive) {
                            toggleBtn.textContent = "Deactivate Inspector";
                            toggleBtn.classList.add("active");
                            setStatus("Click any element to steal it");
                            window.close();
                        } else {
                            toggleBtn.textContent = "Activate Inspector";
                            toggleBtn.classList.remove("active");
                            setStatus("Inspector deactivated");
                        }
                    }
                );
            });
        });
    };

    copyBtn.onclick = () => {
        getActiveTab((tab) => {
            setStatus("Copying...");

            // Set a timeout in case the operation hangs
            const timeout = setTimeout(() => {
                setStatus("Copy timed out - page too large?");
            }, 10000);

            // Get the HTML from content script, then copy in popup (which is focused)
            chrome.tabs.sendMessage(tab.id, { action: "getRawCode" }, (res) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    setStatus("Error: " + chrome.runtime.lastError.message);
                    return;
                }
                if (res?.success && res.html) {
                    // Copy in the popup context (it's focused)
                    navigator.clipboard.writeText(res.html)
                        .then(() => {
                            setStatus("Full page copied!");
                        })
                        .catch((err) => {
                            setStatus("Copy failed: " + err.message);
                        });
                } else {
                    setStatus("Failed to get page HTML");
                }
            });
        });
    };

    previewBtn.onclick = () => {
        getActiveTab((tab) => {
            ensureContent(tab.id, () => {
                setStatus("Capturing...");

                // Set a timeout for large pages
                const timeout = setTimeout(() => {
                    setStatus("Capture timed out - page too large?");
                }, 15000);

                chrome.tabs.sendMessage(tab.id, { action: "getRawCode" }, (res) => {
                    clearTimeout(timeout);
                    if (chrome.runtime.lastError) {
                        setStatus("Error: " + chrome.runtime.lastError.message);
                        return;
                    }
                    if (res && res.success) {
                        chrome.storage.local.set({
                            'stolenHTML': res.html,
                            'pageUrl': res.url
                        }, () => {
                            chrome.tabs.create({ url: 'preview.html' });
                            window.close();
                        });
                    } else {
                        setStatus("Failed: " + (res?.error || "Could not capture page"));
                    }
                });
            });
        });
    };

    clearBtn.onclick = () => {
        chrome.storage.local.set({ dockItems: [] }, () => {
            activeCategory = 'all';
            renderDock();
            setStatus("Cleared!");
        });
    };

    scrapeBtn.onclick = () => {
        getActiveTab((tab) => {
            ensureContent(tab.id, () => {
                setStatus("Scraping page...");
                scrapeBtn.disabled = true;

                const timeout = setTimeout(() => {
                    setStatus("Scrape timed out — page may be too complex");
                    scrapeBtn.disabled = false;
                }, 30000);

                chrome.tabs.sendMessage(tab.id, { action: "scrapePage" }, (res) => {
                    clearTimeout(timeout);
                    scrapeBtn.disabled = false;
                    if (chrome.runtime.lastError) {
                        setStatus("Error: " + chrome.runtime.lastError.message);
                        return;
                    }
                    if (res?.success) {
                        const summary = Object.entries(res.groupCounts || {})
                            .map(([t, c]) => `${c} ${t}`).join(', ');
                        setStatus(`Scraped ${res.captured} components — ${summary}`);
                    } else {
                        setStatus("Scrape failed: " + (res?.error || 'unknown'));
                    }
                });
            });
        });
    };

    // --- HTML PROCESSORS ---
    // Accepts either a dock item { html, extraCss } or a raw html string.
    // Prepends a <style> block with pseudo-element / keyframe CSS when present,
    // but only for tailwind and raw modes (universal inlines everything).
    // Build the inline-style strings for the ancestor-context wrapper and the
    // optional parent-layout inner wrapper. Returns a render function so the
    // caller can inject any already-transformed body HTML.
    function ancestorContextWrapper(ctx) {
        if (!ctx) return null;
        const outerDecls = [];
        if (ctx.pageBg) outerDecls.push(`background: ${ctx.pageBg}`);
        if (ctx.color) outerDecls.push(`color: ${ctx.color}`);
        if (ctx.fontFamily) outerDecls.push(`font-family: ${ctx.fontFamily}`);
        const outerStyle = outerDecls.join('; ');

        // Parent-layout wrapper (only when parent is flex/grid). Emits the
        // minimal set of properties needed for a flex/grid child to lay out.
        let innerStyle = '';
        if (ctx.parentLayout) {
            const pl = ctx.parentLayout;
            const kebab = (k) => k.replace(/([A-Z])/g, '-$1').toLowerCase();
            const decls = [];
            for (const [k, v] of Object.entries(pl)) {
                if (!v || v === 'normal' || v === 'none' || v === 'auto') continue;
                decls.push(`${kebab(k)}: ${v}`);
            }
            innerStyle = decls.join('; ');
        }

        if (!outerStyle && !innerStyle) return null;
        return { outerStyle, innerStyle };
    }

    function processHtmlForCopy(item, mode) {
        const html = typeof item === 'string' ? item : item.html;
        const extraCss = typeof item === 'string' ? '' : (item.extraCss || '');
        const ancestorContext = typeof item === 'string' ? null : (item.ancestorContext || null);

        const div = document.createElement('div');
        div.innerHTML = html;
        const root = div.firstElementChild;
        if (!root) return html;

        // JSX mode runs on top of the tailwind-converted DOM — classes merged,
        // inline styles dropped.
        const effectiveMode = mode === 'jsx' ? 'tailwind' : mode;

        const all = [root, ...root.querySelectorAll('*')];
        all.forEach(el => {
            if (effectiveMode === 'tailwind') {
                const tw = el.getAttribute('data-tw');
                if (tw) {
                    // Merge captured TW classes with any ed-p-N pseudo marker classes
                    const pseudoMarkers = Array.from(el.classList).filter(c => c.startsWith('ed-p-'));
                    el.className = [tw, ...pseudoMarkers].join(' ').trim();
                    el.removeAttribute('data-tw');
                    el.removeAttribute('style');
                }
                el.removeAttribute('data-inline-style');
            } else if (effectiveMode === 'universal') {
                const inlineStyle = el.getAttribute('data-inline-style');
                if (inlineStyle) {
                    el.setAttribute('style', inlineStyle);
                    el.removeAttribute('class');
                    el.removeAttribute('data-inline-style');
                }
                el.removeAttribute('data-tw');
            } else {
                el.removeAttribute('data-tw');
                el.removeAttribute('data-inline-style');
            }
            el.removeAttribute('data-is-canvas');
            el.removeAttribute('data-width');
            el.removeAttribute('data-height');
        });

        let body = root.outerHTML;

        // Preflight — only for portable-output modes (Universal, JSX). Tailwind
        // users already have preflight in their project; Raw-HTML users want
        // the source unmodified. Prepended AHEAD of extraCss so pseudo/keyframe
        // rules can still override reset defaults.
        const includePreflight = (mode === 'universal' || mode === 'jsx');
        const preflight = includePreflight ? getPreflightCss() : '';

        // Ancestor-context wrapping — also only portable-output modes. Wraps
        // the body in one or two divs that replicate the captured parent
        // background / font / layout so standalone rendering matches the source.
        const wrapInfo = includePreflight ? ancestorContextWrapper(ancestorContext) : null;
        function applyWrapper(inner) {
            if (!wrapInfo) return inner;
            let out = inner;
            if (wrapInfo.innerStyle) out = `<div data-ed-parent-layout style="${wrapInfo.innerStyle}">${out}</div>`;
            if (wrapInfo.outerStyle) out = `<div data-ed-ancestor-context style="${wrapInfo.outerStyle}">${out}</div>`;
            return out;
        }

        // JSX mode: take the tailwind-converted DOM and rewrite it as JSX.
        if (mode === 'jsx') {
            body = htmlToJsx(root);
            // For JSX, wrap via string — no DOM needed. Match style={{}} syntax.
            if (wrapInfo) {
                const styleObj = (s) => '{{' + s.split(';').map(d => d.trim()).filter(Boolean).map(d => {
                    const [k, ...v] = d.split(':');
                    return `${k.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase())}: '${v.join(':').trim().replace(/'/g, "\\'")}'`;
                }).join(', ') + '}}';
                if (wrapInfo.innerStyle) body = `<div style=${styleObj(wrapInfo.innerStyle)}>\n${body}\n</div>`;
                if (wrapInfo.outerStyle) body = `<div style=${styleObj(wrapInfo.outerStyle)}>\n${body}\n</div>`;
            }
            const cssBlob = [preflight, extraCss].filter(Boolean).join('\n');
            if (cssBlob) {
                const escaped = cssBlob.replace(/`/g, '\\`');
                return `<>\n<style>{\`${escaped}\`}</style>\n${body}\n</>`;
            }
            return body;
        }

        const cssBlob = [preflight, extraCss].filter(Boolean).join('\n');
        const wrapped = applyWrapper(body);
        if (cssBlob && (mode === 'tailwind' || mode === 'universal' || mode === 'raw')) {
            return `<style>${cssBlob}</style>\n${wrapped}`;
        }
        return wrapped;
    }

    // Resolve the preflight CSS string. The engine exposes it on
    // `window.__easyDivEngine` in the captured page; we fetch it via a
    // roundtrip cache since this popup runs in its own isolated context.
    let _preflightCache = null;
    function getPreflightCss() {
        if (_preflightCache !== null) return _preflightCache;
        _preflightCache = PREFLIGHT_CSS_LOCAL;
        return _preflightCache;
    }

    // Inline copy of the preflight so popup.js works standalone without
    // reaching into the content script's isolated world. Keep in sync with
    // content.js PREFLIGHT_CSS — changes there should mirror here.
    const PREFLIGHT_CSS_LOCAL = [
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

    // =========================================================================
    // HTML → JSX converter
    //
    // Operates on a cleaned DOM subtree (post-transform: data-tw already merged
    // into class in tailwind mode). Produces a JSX string.
    //
    // Handled:
    //   - attribute renames (class→className, for→htmlFor, SVG kebab→camel, …)
    //   - inline `style="..."` → `style={{ prop: 'val' }}` object
    //   - void elements self-closed (`<img />`)
    //   - text nodes escape `{`, `}` so JSX doesn't treat them as expressions
    //   - HTML comments → `{/* … */}`
    //   - strips inline event handlers (on*) — safety net, engine already does
    // =========================================================================
    const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
        'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

    // Explicit HTML attribute renames that aren't just kebab→camel.
    // Keys are always lowercase (HTML parser normalizes attr names on input).
    const ATTR_RENAME = {
        // HTML
        'class': 'className', 'for': 'htmlFor',
        'tabindex': 'tabIndex', 'readonly': 'readOnly',
        'maxlength': 'maxLength', 'minlength': 'minLength',
        'autofocus': 'autoFocus', 'autocomplete': 'autoComplete',
        'autoplay': 'autoPlay', 'autocapitalize': 'autoCapitalize',
        'autocorrect': 'autoCorrect', 'autosave': 'autoSave',
        'contenteditable': 'contentEditable', 'spellcheck': 'spellCheck',
        'crossorigin': 'crossOrigin', 'srcset': 'srcSet',
        'srcdoc': 'srcDoc', 'srclang': 'srcLang',
        'accesskey': 'accessKey', 'datetime': 'dateTime',
        'cellpadding': 'cellPadding', 'cellspacing': 'cellSpacing',
        'colspan': 'colSpan', 'rowspan': 'rowSpan',
        'formaction': 'formAction', 'formenctype': 'formEncType',
        'formmethod': 'formMethod', 'formnovalidate': 'formNoValidate',
        'formtarget': 'formTarget', 'frameborder': 'frameBorder',
        'hreflang': 'hrefLang', 'http-equiv': 'httpEquiv',
        'marginheight': 'marginHeight', 'marginwidth': 'marginWidth',
        'novalidate': 'noValidate', 'radiogroup': 'radioGroup',
        'usemap': 'useMap', 'charset': 'charSet', 'enctype': 'encType',
        'inputmode': 'inputMode', 'itemid': 'itemID', 'itemprop': 'itemProp',
        'itemref': 'itemRef', 'itemscope': 'itemScope', 'itemtype': 'itemType',
        'allowfullscreen': 'allowFullScreen', 'allowreorder': 'allowReorder',
        'playsinline': 'playsInline',
        // SVG — HTML parser lowercases these, but React wants camelCase
        'viewbox': 'viewBox', 'preserveaspectratio': 'preserveAspectRatio',
        'clippathunits': 'clipPathUnits', 'gradientunits': 'gradientUnits',
        'gradienttransform': 'gradientTransform', 'spreadmethod': 'spreadMethod',
        'patternunits': 'patternUnits', 'patterntransform': 'patternTransform',
        'patterncontentunits': 'patternContentUnits',
        'maskunits': 'maskUnits', 'maskcontentunits': 'maskContentUnits',
        'primitiveunits': 'primitiveUnits', 'filterunits': 'filterUnits',
        'filterres': 'filterRes',
        'textlength': 'textLength', 'lengthadjust': 'lengthAdjust',
        'startoffset': 'startOffset',
        'pathlength': 'pathLength', 'numoctaves': 'numOctaves',
        'kernelmatrix': 'kernelMatrix', 'kernelunitlength': 'kernelUnitLength',
        'diffuseconstant': 'diffuseConstant', 'specularconstant': 'specularConstant',
        'specularexponent': 'specularExponent', 'surfacescale': 'surfaceScale',
        'tablevalues': 'tableValues', 'basefrequency': 'baseFrequency',
        'edgemode': 'edgeMode', 'stddeviation': 'stdDeviation',
        'limitingconeangle': 'limitingConeAngle', 'pointsatx': 'pointsAtX',
        'pointsaty': 'pointsAtY', 'pointsatz': 'pointsAtZ',
        'xchannelselector': 'xChannelSelector', 'ychannelselector': 'yChannelSelector',
        'zoomandpan': 'zoomAndPan', 'contentstyletype': 'contentStyleType',
        'contentscripttype': 'contentScriptType'
    };

    function kebabToCamel(s) {
        return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }

    function convertAttrName(name) {
        const lower = name.toLowerCase();
        if (ATTR_RENAME[lower]) return ATTR_RENAME[lower];
        // Namespaced attrs keep their colons (xmlns:xlink, xml:lang)
        if (name.includes(':')) return name;
        // ARIA and data-* pass through
        if (lower.startsWith('aria-') || lower.startsWith('data-')) return lower;
        // SVG-style kebab-case → camelCase
        if (name.includes('-')) return kebabToCamel(lower);
        return lower;
    }

    // CSS property names that shouldn't be camelCased in React style objects
    // (custom properties prefixed with --).
    function cssPropToJsKey(prop) {
        if (prop.startsWith('--')) return `'${prop}'`; // keep as quoted key
        if (prop.startsWith('-')) {
            // vendor prefix: -webkit-transform → WebkitTransform
            return prop.slice(1).replace(/^([a-z])/, (_, c) => c.toUpperCase()).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        }
        return kebabToCamel(prop);
    }

    function styleStringToJsxObject(styleStr) {
        const entries = [];
        for (const decl of styleStr.split(';')) {
            const s = decl.trim();
            if (!s) continue;
            const i = s.indexOf(':');
            if (i < 0) continue;
            const prop = s.slice(0, i).trim();
            const val = s.slice(i + 1).trim();
            const key = cssPropToJsKey(prop);
            // Quote value; escape single quotes + backslashes
            const quotedVal = "'" + val.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
            const entryKey = key.startsWith("'") ? key : key; // already quoted if custom prop
            entries.push(`${entryKey}: ${quotedVal}`);
        }
        return `{{${entries.join(', ')}}}`;
    }

    function escapeJsxText(text) {
        // JSX treats `{` and `}` as expression delimiters; also `<` and `>` break parsing.
        return text
            .replace(/\{/g, '{`{`}')
            .replace(/\}/g, '{`}`}')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function attrValueToJsx(value) {
        // Always quote as JSX string literal; escape `"` and newlines.
        const safe = String(value).replace(/"/g, '&quot;');
        return `"${safe}"`;
    }

    function htmlToJsx(node, indent = 0) {
        const pad = '  '.repeat(indent);

        if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent;
            if (!t || !t.trim()) return t.replace(/\s+/g, ' '); // preserve whitespace tokens between tags
            return escapeJsxText(t);
        }
        if (node.nodeType === Node.COMMENT_NODE) {
            return `${pad}{/* ${node.textContent.replace(/\*\//g, '* /')} */}`;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        const attrParts = [];

        for (const attr of Array.from(node.attributes)) {
            // Belt & suspenders — inline event handlers should never reach here,
            // but if they do, drop them (React expects functions, not strings).
            if (/^on[a-z]/i.test(attr.name)) continue;

            if (attr.name.toLowerCase() === 'style') {
                attrParts.push(`style=${styleStringToJsxObject(attr.value)}`);
                continue;
            }
            const jsxName = convertAttrName(attr.name);
            // Boolean attrs without value — render as `name` (JSX implicit true)
            if (attr.value === '' || attr.value === jsxName || attr.value === attr.name) {
                // Still emit with empty string for stable output unless it's a known bool
                attrParts.push(`${jsxName}=""`);
            } else {
                attrParts.push(`${jsxName}=${attrValueToJsx(attr.value)}`);
            }
        }

        const attrStr = attrParts.length ? ' ' + attrParts.join(' ') : '';
        const isVoid = VOID_TAGS.has(tag);
        const childNodes = Array.from(node.childNodes);

        if (isVoid || childNodes.length === 0) {
            return `${pad}<${tag}${attrStr} />`;
        }

        // Render children
        let inner = '';
        let onlyText = childNodes.every(c => c.nodeType === Node.TEXT_NODE);
        for (const c of childNodes) {
            const rendered = htmlToJsx(c, onlyText ? 0 : indent + 1);
            if (!rendered) continue;
            inner += onlyText ? rendered : ('\n' + rendered);
        }
        if (onlyText) {
            return `${pad}<${tag}${attrStr}>${inner}</${tag}>`;
        }
        return `${pad}<${tag}${attrStr}>${inner}\n${pad}</${tag}>`;
    }

    function renderCategoryFilter(allItems) {
        // Collect counts per category. Items without `category` go into "captured".
        const counts = { all: allItems.length };
        for (const it of allItems) {
            const cat = it.category || 'captured';
            counts[cat] = (counts[cat] || 0) + 1;
        }
        const categories = Object.keys(counts);
        if (categories.length <= 2) {
            // Nothing to filter by
            categoryFilter.style.display = 'none';
            return;
        }
        categoryFilter.style.display = 'flex';
        categoryFilter.innerHTML = categories.map(cat => {
            const isActive = activeCategory === cat;
            return `<button class="cat-pill" data-cat="${cat}" style="
                font-size:10px; padding:3px 9px; border-radius:10px;
                border:1px solid ${isActive ? 'rgba(34,197,94,0.35)' : '#2a2a2e'};
                background:${isActive ? 'rgba(34,197,94,0.12)' : '#18181b'};
                color:${isActive ? '#4ade80' : '#a1a1aa'}; cursor:pointer;
                font-family:inherit; font-weight:500; letter-spacing:-0.01em;">
                ${cat} (${counts[cat]})
            </button>`;
        }).join('');
        categoryFilter.querySelectorAll('.cat-pill').forEach(btn => {
            btn.onclick = (e) => {
                activeCategory = e.currentTarget.dataset.cat;
                renderDock();
            };
        });
    }

    function renderDock() {
        chrome.storage.local.get({ dockItems: [] }, (result) => {
            const allItems = result.dockItems || [];
            renderCategoryFilter(allItems);

            const items = activeCategory === 'all'
                ? allItems
                : allItems.filter(it => (it.category || 'captured') === activeCategory);

            dockCount.textContent = items.length;

            if (items.length === 0) {
                dockList.innerHTML = `
          <div class="empty-state">
            <div class="icon">.</div>
            <h3>${allItems.length === 0 ? 'No components yet' : 'No items in this category'}</h3>
            <p>${allItems.length === 0 ? 'Activate the inspector and click on any element, or run Scrape Page.' : 'Switch category to see others.'}</p>
          </div>
        `;
                return;
            }

            dockList.innerHTML = items.map((item, index) => `
        <div class="dock-item" data-index="${index}">
          <div class="dock-item-header">
            <div class="dock-item-meta">
              <span class="dock-item-source">${item.source}</span>
              ${item.category ? `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(34,197,94,0.12);color:#4ade80;border:1px solid rgba(34,197,94,0.25);font-weight:500;letter-spacing:0.02em;">${item.category}</span>` : ''}
              <span class="dock-item-time">${item.timestamp}</span>
            </div>
            <div class="dock-item-actions">
              <div class="copy-menu" data-index="${index}">
                <button class="btn-copy-menu" title="Copy as…">
                  Copy
                  <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div class="copy-menu-panel" hidden>
                  <button data-mode="raw">HTML <span class="menu-hint">original</span></button>
                  <button data-mode="tailwind">Tailwind <span class="menu-hint">data-tw</span></button>
                  <button data-mode="universal">Universal <span class="menu-hint">inline CSS</span></button>
                  <button data-mode="jsx">JSX <span class="menu-hint">React</span></button>
                </div>
              </div>
              <button class="btn-view" data-index="${index}">View</button>
              <button class="btn-delete" data-index="${index}">×</button>
            </div>
          </div>
          <div class="preview-box" data-index="${index}">
            <div class="preview-overlay"></div>
          </div>
        </div>
      `).join("");

            // Render previews in iframes with dynamic sizing
            items.forEach((item, index) => {
                const previewBox = dockList.querySelector(`.preview-box[data-index="${index}"]`);
                if (previewBox) {
                    // Estimate element size from HTML to determine scale
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = item.html;
                    const rootEl = tempDiv.firstElementChild;

                    // Determine preview sizing based on element type/content
                    let scale = 0.35;
                    let boxHeight = 60;
                    let iframeWidth = 340;
                    let iframeHeight = 180;

                    if (rootEl) {
                        const tagName = rootEl.tagName.toLowerCase();
                        const classList = rootEl.className || '';
                        const styleAttr = rootEl.getAttribute('style') || '';

                        // Check for small elements (buttons, badges, inputs)
                        const isSmallElement = ['button', 'a', 'input', 'span', 'label', 'badge'].includes(tagName) ||
                            classList.includes('btn') || classList.includes('button') || classList.includes('badge') ||
                            classList.includes('chip') || classList.includes('tag');

                        // Check for medium elements (cards, modals, forms)
                        const isMediumElement = ['form', 'article', 'section', 'aside'].includes(tagName) ||
                            classList.includes('card') || classList.includes('modal') || classList.includes('form');

                        // Check for large elements (full sections, navbars, footers)
                        const isLargeElement = ['nav', 'header', 'footer', 'main', 'div'].includes(tagName) &&
                            (rootEl.children.length > 5 || item.html.length > 2000);

                        if (isSmallElement) {
                            // Small elements: show larger, centered
                            scale = 1;
                            boxHeight = 40;
                            iframeWidth = 340;
                            iframeHeight = 50;
                            previewBox.classList.add('size-small');
                        } else if (isLargeElement) {
                            // Large elements: scale down more
                            scale = 0.25;
                            boxHeight = 80;
                            iframeWidth = 1200;
                            iframeHeight = 400;
                            previewBox.classList.add('size-large');
                        } else {
                            // Medium elements: balanced
                            scale = 0.4;
                            boxHeight = 60;
                            iframeWidth = 850;
                            iframeHeight = 200;
                            previewBox.classList.add('size-medium');
                        }
                    }

                    previewBox.style.height = `${boxHeight}px`;

                    const iframe = document.createElement('iframe');
                    iframe.sandbox = 'allow-same-origin allow-scripts';
                    iframe.style.cssText = `width:${iframeWidth}px;height:${iframeHeight}px;border:none;transform:scale(${scale});transform-origin:top left;pointer-events:none;background:transparent;`;
                    previewBox.insertBefore(iframe, previewBox.firstChild);

                    // Build a fully self-contained document and hand it to the
                    // iframe via srcdoc. Universal mode bakes all captured styles
                    // as inline `style` attributes — no network, no CDN, no JIT
                    // race, no extension-CSP issues. Matches what the user sees.
                    const previewHtml = processHtmlForCopy(item, 'universal');
                    const base = item.url ? `<base href="${item.url}">` : '';
                    const lottie = item.hasLottie
                        ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>'
                        : '';
                    const srcdoc = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
${base}
${lottie}
<style>html,body{margin:0;padding:0;background:transparent}body{padding:4px;}</style>
</head><body>${previewHtml}</body></html>`;
                    iframe.setAttribute('srcdoc', srcdoc);
                }
            });

            attachItemListeners(items);
        });
    }

    function attachItemListeners(items) {
        // One unified copy-mode dropdown per dock item. The menu hosts all four
        // modes (raw/tailwind/universal/jsx) which used to be separate buttons.
        const closeAllMenus = () => {
            document.querySelectorAll(".copy-menu-panel").forEach(p => { p.hidden = true; });
        };

        document.querySelectorAll(".copy-menu").forEach(menu => {
            const trigger = menu.querySelector(".btn-copy-menu");
            const panel = menu.querySelector(".copy-menu-panel");
            const index = parseInt(menu.dataset.index);

            trigger.addEventListener("click", (e) => {
                e.stopPropagation();
                const wasHidden = panel.hidden;
                closeAllMenus();
                panel.hidden = !wasHidden;
            });

            panel.querySelectorAll("button[data-mode]").forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const mode = btn.dataset.mode;
                    const MODE_LABEL = {
                        raw: 'HTML', tailwind: 'Tailwind', universal: 'Universal', jsx: 'JSX'
                    };
                    setStatus(`Generating ${MODE_LABEL[mode]}…`);
                    setTimeout(() => {
                        try {
                            const out = processHtmlForCopy(items[index], mode);
                            navigator.clipboard.writeText(out).then(() => {
                                setStatus(`Copied ${MODE_LABEL[mode]}!`);
                                panel.hidden = true;
                            });
                        } catch (err) {
                            setStatus(`${MODE_LABEL[mode]} failed: ${err.message}`);
                        }
                    }, 10);
                });
            });
        });

        // Close any open menu when clicking outside one
        document.addEventListener("click", closeAllMenus);

        document.querySelectorAll(".btn-view").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);
                const item = items[index];

                chrome.storage.local.set({
                    previewItem: item,
                    stolenHTML: item.html,
                    pageUrl: item.url
                }, () => {
                    chrome.tabs.create({ url: "preview.html" });
                });
            });
        });

        document.querySelectorAll(".btn-delete").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);
                const targetId = items[index]?.id;
                if (!targetId) return;
                // Remove from full list (not the filtered view) so other categories aren't wiped
                chrome.storage.local.get({ dockItems: [] }, (res) => {
                    const full = (res.dockItems || []).filter(it => it.id !== targetId);
                    chrome.storage.local.set({ dockItems: full }, () => renderDock());
                });
            });
        });
    }

    renderDock();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === "local" && changes.dockItems) {
            renderDock();
        }
    });
});
