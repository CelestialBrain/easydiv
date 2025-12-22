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
    // Check if full page by looking for Doctype or html tag at the start
    const isFullPage = /^\s*<!DOCTYPE/i.test(html) || /^\s*<html/i.test(html);

    if (isFullPage) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Process elements
        doc.querySelectorAll('*').forEach(el => {
            if (mode === 'tailwind') {
                const tw = el.getAttribute('data-tw');
                if (tw) {
                    el.className = tw;
                    el.removeAttribute('data-tw');
                    el.removeAttribute('style');
                }
            } else {
                el.removeAttribute('data-tw');
            }
            // Cleanup checks
            el.removeAttribute('data-is-canvas');
            el.removeAttribute('data-width');
            el.removeAttribute('data-height');
        });

        // Sanitize
        doc.querySelectorAll('script, noscript').forEach(el => el.remove());
        doc.querySelectorAll('link[href*="auth-bridge"], link[href*="login"]').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
            });
        });

        return doc.documentElement.outerHTML;
    } else {
        // Component Fragment or just body content
        const div = document.createElement('div');
        div.innerHTML = html;
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
                el.removeAttribute('data-tw');
            }

            el.removeAttribute('data-is-canvas');
            el.removeAttribute('data-width');
            el.removeAttribute('data-height');
        });

        // Sanitize string
        let processed = root.outerHTML;
        processed = processed.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        processed = processed.replace(/<script[^>]*\/>/gi, '');
        processed = processed.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
        processed = processed.replace(/<link[^>]+href=["'][^"']*(?:auth-bridge|login)[^"']*["'][^>]*>/gi, '');
        processed = processed.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

        return processed;
    }
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

    const isFullPage = stolenHTML.match(/^\s*<!DOCTYPE/i) || stolenHTML.match(/^\s*<html/i);
    let content = processHtml(stolenHTML, mode);

    let finalDoc = '';

    if (isFullPage) {
        // Full Page Logic
        // DOMParser.documentElement.outerHTML doesn't include DOCTYPE, try to preserve it from original if possible
        const doctypeMatch = stolenHTML.match(/^\s*<!DOCTYPE[^>]*>/i);
        const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';

        finalDoc = doctype + '\n' + content;

        if (pageUrl) {
            const baseTag = `<base href="${pageUrl}">`;
            // Also inject a viewport meta if not present to help with responsive layouts
            const viewportMeta = `<meta name="viewport" content="width=1920">`;

            // Detect Lottie and inject library if needed
            const hasLottie = content.includes('__lottie_element') ||
                content.includes('lottie-player') ||
                content.includes('bodymovin');
            const lottieScript = hasLottie ?
                '<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>' : '';

            // Inject base tag, viewport, and Lottie carefully
            if (finalDoc.includes('<head>')) {
                finalDoc = finalDoc.replace('<head>', `<head>\n${baseTag}\n${viewportMeta}\n${lottieScript}\n`);
            } else if (finalDoc.includes('<head ')) {
                finalDoc = finalDoc.replace(/<head([^>]*)>/, `<head$1>\n${baseTag}\n${viewportMeta}\n${lottieScript}\n`);
            }
        }
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
