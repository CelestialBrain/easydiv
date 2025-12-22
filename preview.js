const iframe = document.getElementById('canvas');
const sourceBadge = document.getElementById('source-badge');
const copyBtn = document.getElementById('copy-btn');
const backBtn = document.getElementById('back-btn');
const modeOriginalBtn = document.getElementById('mode-original');
const modeTailwindBtn = document.getElementById('mode-tailwind');

let stolenHTML = '';
let pageUrl = '';
let stylesheets = [];
let currentMode = 'original'; // 'original' | 'tailwind'

chrome.storage.local.get(['stolenHTML', 'pageUrl', 'previewItem'], (result) => {
    let html = result.stolenHTML || result.previewItem?.html || "<h1 style='font-family:sans-serif; padding:20px; color:#333;'>No content found. Try capturing again.</h1>";
    pageUrl = result.pageUrl || result.previewItem?.url || '';
    stylesheets = result.previewItem?.stylesheets || [];
    stolenHTML = html;

    // Update source badge
    if (pageUrl) {
        try {
            sourceBadge.textContent = new URL(pageUrl).hostname;
        } catch {
            sourceBadge.textContent = 'Unknown';
        }
    }

    renderPreview('original');
});

function processHtml(html, mode) {
    const div = document.createElement('div');
    div.innerHTML = html;

    // Process full page differently? 
    // If it's a full page capture, our "freezeElement" logic wasn't applied recursively for data-tw generally
    // (Wait, 'copyFullPage' just grabs documentElement.outerHTML).
    // So 'tailwind' mode only really works for 'Captured Components' via inspector, not full page copies.
    // Full page copies don't have data-tw attributes set.

    // For components:
    const root = div.firstElementChild;
    if (!root) return html;

    const all = [root, ...root.querySelectorAll('*')];
    all.forEach(el => {
        if (mode === 'tailwind') {
            const tw = el.getAttribute('data-tw');
            if (tw) {
                el.className = tw;
                el.removeAttribute('data-tw');
                el.removeAttribute('style');
            }
        } else {
            // Original mode: just ignore data-tw, keep original classes
            // We strip data-tw just to keep DOM clean in preview
            el.removeAttribute('data-tw');
        }

        // Cleanup internal markers
        el.removeAttribute('data-is-canvas');
        el.removeAttribute('data-width');
        el.removeAttribute('data-height');
    });

    // Sanitization (Common for both)
    let processed = root.outerHTML;

    // Remove scripts
    processed = processed.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    processed = processed.replace(/<script[^>]*\/>/gi, '');
    processed = processed.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    processed = processed.replace(/<link[^>]+href=["'][^"']*(?:auth-bridge|login)[^"']*["'][^>]*>/gi, '');
    processed = processed.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

    return processed;
}

function renderPreview(mode) {
    currentMode = mode;

    // UI Updates
    if (mode === 'original') {
        modeOriginalBtn.classList.add('active');
        modeTailwindBtn.classList.remove('active');
    } else {
        modeOriginalBtn.classList.remove('active');
        modeTailwindBtn.classList.add('active');
    }

    const isFullPage = stolenHTML.includes('<html') || stolenHTML.includes('<!DOCTYPE');
    let content = processHtml(stolenHTML, mode);

    let finalDoc = '';

    if (isFullPage) {
        // Full Page Logic
        finalDoc = content;
        if (pageUrl) {
            const baseTag = `<base href="${pageUrl}">`;
            if (finalDoc.includes('<head>')) {
                finalDoc = finalDoc.replace('<head>', `<head>\n${baseTag}\n`);
            }
        }
        // Inject Tailwind if needed? Full page usually doesn't have data-tw, so this might be moot.
        // But if we ever support full page analysis, we'd add <script src="cdn..."></script> here.
    } else {
        // Component Logic
        let headContent = `
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${pageUrl ? `<base href="${pageUrl}">` : ''}
        `;

        if (mode === 'original') {
            // Inject original stylesheets
            if (stylesheets.length > 0) {
                headContent += stylesheets
                    .filter(href => !href.includes('chrome-extension://'))
                    .map(href => `<link rel="stylesheet" href="${href}" onerror="this.remove()">`)
                    .join('\n');
            }
            headContent += `
                <style>
                    body { margin: 0; padding: 20px; font-family: system-ui, -apple-system, sans-serif; background: #fff; }
                    /* Fallback to ensure text visibility if styles fail */
                    @media (prefers-color-scheme: dark) {
                        body { background: #1a1a1a; color: #eee; }
                    }
                </style>
            `;
        } else {
            // Tailwind Mode
            headContent += `
                <script src="https://cdn.tailwindcss.com"></script>
                <style>
                    body { margin: 0; padding: 20px; background: #0f172a; } /* Slate-900 bg for contrast */
                </style>
                <script>
                    tailwind.config = {
                        theme: { extend: {} },
                        corePlugins: { preflight: false } // Disable preflight to avoid resetting everything hard? No, let's keep it standard.
                        // Actually, 'preflight: false' helps if the captured component relies on browser defaults, 
                        // but usually Tailwind components rely on preflight being present.
                    }
                </script>
            `;
        }

        finalDoc = `<!DOCTYPE html>
        <html>
        <head>
            ${headContent}
        </head>
        <body>
            ${content}
        </body>
        </html>`;
    }

    iframe.srcdoc = finalDoc;
}

// Event Listeners
modeOriginalBtn.addEventListener('click', () => renderPreview('original'));
modeTailwindBtn.addEventListener('click', () => renderPreview('tailwind'));

copyBtn.addEventListener('click', () => {
    // Copy the PROCESSED html based on current mode
    const finalHtml = processHtml(stolenHTML, currentMode);

    navigator.clipboard.writeText(finalHtml).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.style.background = '#22c55e';
        setTimeout(() => {
            copyBtn.textContent = 'Copy HTML';
            copyBtn.style.background = '';
        }, 1500);
    });
});

backBtn.addEventListener('click', () => {
    window.close();
});
