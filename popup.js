document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.getElementById("toggle-inspector");
    const copyBtn = document.getElementById("copy-full-page");
    const previewBtn = document.getElementById("preview-design");
    const clearBtn = document.getElementById("clear-dock");
    const status = document.getElementById("status-message");
    const dockList = document.getElementById("dock-list");
    const dockCount = document.getElementById("dock-count");

    const setStatus = (msg) => { status.textContent = msg; };

    // Check state on load
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
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
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
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
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
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
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
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
            renderDock();
            setStatus("Cleared!");
        });
    };

    // --- HTML PROCESSORS ---
    function processHtmlForCopy(html, mode) {
        const div = document.createElement('div');
        div.innerHTML = html;
        const root = div.firstElementChild; // Proceed with the single root element we usually capture

        if (!root) return html;

        const all = [root, ...root.querySelectorAll('*')];
        all.forEach(el => {
            if (mode === 'tailwind') {
                const tw = el.getAttribute('data-tw');
                if (tw) {
                    el.className = tw; // Replace classes with Tailwind
                    el.removeAttribute('data-tw');
                    el.removeAttribute('style'); // Remove inline styles as we are using pure TW
                } else {
                    // If no TW data, maybe keep original class? 
                    // Or keep it plain. Let's keep original class if TW not present.
                }
            } else {
                // Clean mode: just remove data-tw
                el.removeAttribute('data-tw');
                // Keep inline styles and original classes
            }

            // Cleanup internal markers
            el.removeAttribute('data-is-canvas');
            el.removeAttribute('data-width');
            el.removeAttribute('data-height');
        });

        // Special cleanup for generated TW
        return root.outerHTML;
    }

    function renderDock() {
        chrome.storage.local.get({ dockItems: [] }, (result) => {
            const items = result.dockItems;
            dockCount.textContent = items.length;

            if (items.length === 0) {
                dockList.innerHTML = `
          <div class="empty-state">
            <div class="icon">.</div>
            <h3>No components yet</h3>
            <p>Activate the inspector and click on any element to capture it.</p>
          </div>
        `;
                return;
            }

            dockList.innerHTML = items.map((item, index) => `
        <div class="dock-item" data-index="${index}">
          <div class="dock-item-header">
            <div class="dock-item-meta">
              <span class="dock-item-source">${item.source}</span>
              <span class="dock-item-time">${item.timestamp}</span>
            </div>
            <div class="dock-item-actions">
              <button class="btn-copy-raw" data-index="${index}" title="Copy HTML with original classes">HTML</button>
              <button class="btn-copy-tw" data-index="${index}" title="Copy with Tailwind CSS">TW</button>
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
                    iframe.style.cssText = `width:${iframeWidth}px;height:${iframeHeight}px;border:none;transform:scale(${scale});transform-origin:top left;pointer-events:none;background:#1a1a1f;`;
                    previewBox.insertBefore(iframe, previewBox.firstChild);

                    setTimeout(() => {
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow.document;
                            doc.open();

                            // Start with doctype and head
                            doc.write('<!DOCTYPE html><html><head>');

                            if (item.url) {
                                doc.write(`<base href="${item.url}">`);
                            }

                            // Inject Tailwind CDN for proper styling (most captured components use Tailwind)
                            doc.write('<script src="https://cdn.tailwindcss.com"></script>');

                            // Also inject original stylesheets as fallback
                            if (item.stylesheets) {
                                item.stylesheets.forEach(href => {
                                    doc.write(`<link rel="stylesheet" href="${href}" onerror="this.remove()">`);
                                });
                            }

                            doc.write('</head>');
                            doc.write(`<body style="margin:0;padding:8px;background:#1a1a1f;display:flex;justify-content:flex-start;align-items:flex-start;">${item.html}</body></html>`);
                            doc.close();
                        } catch (e) {
                            console.log('Preview error:', e);
                        }
                    }, 50);
                }
            });

            attachItemListeners(items);
        });
    }

    function attachItemListeners(items) {
        // Copy RAW HTML
        document.querySelectorAll(".btn-copy-raw").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);
                const rawHtml = processHtmlForCopy(items[index].html, 'raw');

                navigator.clipboard.writeText(rawHtml).then(() => {
                    setStatus("Copied HTML!");
                    const originalText = e.target.textContent;
                    e.target.textContent = "OK";
                    setTimeout(() => { e.target.textContent = originalText; }, 1000);
                });
            });
        });

        // Copy TAILWIND
        document.querySelectorAll(".btn-copy-tw").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);

                // Show analyzing state as this might take a ms
                setStatus("Generating Tailwind...");

                // Use setTimeout to allow UI update
                setTimeout(() => {
                    const twHtml = processHtmlForCopy(items[index].html, 'tailwind');
                    navigator.clipboard.writeText(twHtml).then(() => {
                        setStatus("Copied Tailwind!");
                        const originalText = e.target.textContent;
                        e.target.textContent = "OK";
                        setTimeout(() => { e.target.textContent = originalText; }, 1000);
                    });
                }, 10);
            });
        });

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
                items.splice(index, 1);

                chrome.storage.local.set({ dockItems: items }, () => {
                    renderDock();
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
