const iframe = document.getElementById('canvas');
const sourceBadge = document.getElementById('source-badge');
const copyBtn = document.getElementById('copy-btn');
const backBtn = document.getElementById('back-btn');
const modeOriginalBtn = document.getElementById('mode-original');
const modeTailwindBtn = document.getElementById('mode-tailwind');
const modeUniversalBtn = document.getElementById('mode-universal');

let stolenHTML = '';
let pageUrl = '';
let stylesheets = [];
let extraCss = '';
let currentMode = 'original'; // 'original' | 'tailwind' | 'universal'

chrome.storage.local.get(['stolenHTML', 'pageUrl', 'previewItem'], (result) => {
    let html = result.stolenHTML || result.previewItem?.html || "<h1 style='font-family:sans-serif; padding:20px; color:#333;'>No content found. Try capturing again.</h1>";
    pageUrl = result.pageUrl || result.previewItem?.url || '';
    stylesheets = result.previewItem?.stylesheets || [];
    extraCss = result.previewItem?.extraCss || '';
    stolenHTML = html;

    if (pageUrl) {
        try { sourceBadge.textContent = new URL(pageUrl).hostname; }
        catch { sourceBadge.textContent = 'Unknown'; }
    }

    renderPreview('original');
});

// Transforms every element in `root` according to mode:
//   - 'original': strip ALL data-* helpers, keep original classes
//   - 'tailwind': replace class with data-tw contents (merge pseudo markers), drop inline styles
//   - 'universal': replace inline style with data-inline-style contents, drop original classes
function transformForMode(root, mode) {
    const all = [root, ...root.querySelectorAll('*')];
    all.forEach(el => {
        if (mode === 'tailwind') {
            const tw = el.getAttribute('data-tw');
            if (tw) {
                const pseudoMarkers = Array.from(el.classList).filter(c => c.startsWith('ed-p-'));
                el.className = [tw, ...pseudoMarkers].join(' ').trim();
                el.removeAttribute('style');
            }
        } else if (mode === 'universal') {
            const inlineStyle = el.getAttribute('data-inline-style');
            if (inlineStyle) {
                const pseudoMarkers = Array.from(el.classList).filter(c => c.startsWith('ed-p-'));
                el.setAttribute('style', inlineStyle);
                el.className = pseudoMarkers.join(' '); // keep only pseudo markers
            }
        }
        // Always strip helper data attributes
        el.removeAttribute('data-tw');
        el.removeAttribute('data-inline-style');
        el.removeAttribute('data-is-canvas');
        el.removeAttribute('data-width');
        el.removeAttribute('data-height');
    });
}

function processHtml(html, mode) {
    const isFullPage = /^\s*<!DOCTYPE/i.test(html) || /^\s*<html/i.test(html);

    if (isFullPage) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        transformForMode(doc.documentElement, mode);

        // Sanitize
        doc.querySelectorAll('script, noscript').forEach(el => el.remove());
        doc.querySelectorAll('link[href*="auth-bridge"], link[href*="login"]').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
            });
        });

        return doc.documentElement.outerHTML;
    }

    // Component fragment
    const div = document.createElement('div');
    div.innerHTML = html;
    const root = div.firstElementChild;
    if (!root) return html;

    transformForMode(root, mode);

    let processed = root.outerHTML;
    processed = processed.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    processed = processed.replace(/<script[^>]*\/>/gi, '');
    processed = processed.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');
    processed = processed.replace(/<link[^>]+href=["'][^"']*(?:auth-bridge|login)[^"']*["'][^>]*>/gi, '');
    processed = processed.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');

    return processed;
}

function renderPreview(mode) {
    currentMode = mode;

    [modeOriginalBtn, modeTailwindBtn, modeUniversalBtn].forEach(b => b?.classList.remove('active'));
    if (mode === 'original') modeOriginalBtn?.classList.add('active');
    else if (mode === 'tailwind') modeTailwindBtn?.classList.add('active');
    else if (mode === 'universal') modeUniversalBtn?.classList.add('active');

    const isFullPage = /^\s*<!DOCTYPE/i.test(stolenHTML) || /^\s*<html/i.test(stolenHTML);
    let content = processHtml(stolenHTML, mode);
    let finalDoc = '';

    if (isFullPage) {
        const doctypeMatch = stolenHTML.match(/^\s*<!DOCTYPE[^>]*>/i);
        const doctype = doctypeMatch ? doctypeMatch[0] : '<!DOCTYPE html>';
        finalDoc = doctype + '\n' + content;

        if (pageUrl) {
            const baseTag = `<base href="${pageUrl}">`;
            const viewportMeta = `<meta name="viewport" content="width=1920">`;
            const hasLottie = content.includes('__lottie_element') ||
                content.includes('lottie-player') || content.includes('bodymovin');
            const lottieScript = hasLottie ?
                '<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>' : '';

            const inject = `${baseTag}\n${viewportMeta}\n${lottieScript}\n${extraCss ? `<style>${extraCss}</style>` : ''}`;
            if (finalDoc.includes('<head>')) {
                finalDoc = finalDoc.replace('<head>', `<head>\n${inject}`);
            } else if (finalDoc.includes('<head ')) {
                finalDoc = finalDoc.replace(/<head([^>]*)>/, `<head$1>\n${inject}`);
            }
        }
    } else {
        let headContent = `
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${pageUrl ? `<base href="${pageUrl}">` : ''}
        `;

        if (extraCss) headContent += `<style>${extraCss}</style>`;

        if (mode === 'original') {
            if (stylesheets.length > 0) {
                headContent += stylesheets
                    .filter(href => !href.includes('chrome-extension://'))
                    .map(href => `<link rel="stylesheet" href="${href}" onerror="this.remove()">`)
                    .join('\n');
            }
            headContent += `
                <style>
                    body { margin: 0; padding: 20px; font-family: system-ui, -apple-system, sans-serif; background: #fff; }
                    @media (prefers-color-scheme: dark) {
                        body { background: #1a1a1a; color: #eee; }
                    }
                </style>
            `;
        } else if (mode === 'tailwind') {
            headContent += `
                <script src="https://cdn.tailwindcss.com"></script>
                <style>body { margin: 0; padding: 20px; background: #0f172a; }</style>
            `;
        } else {
            // universal — inline styles are fully self-contained
            headContent += `<style>body { margin: 0; padding: 20px; background: #fff; }</style>`;
        }

        finalDoc = `<!DOCTYPE html>
<html>
<head>${headContent}</head>
<body>${content}</body>
</html>`;
    }

    iframe.srcdoc = finalDoc;
}

// Builds the final HTML payload for copy — prepends <style> block when extraCss present.
function buildCopyPayload(mode) {
    const body = processHtml(stolenHTML, mode);
    return extraCss ? `<style>${extraCss}</style>\n${body}` : body;
}

modeOriginalBtn.addEventListener('click', () => renderPreview('original'));
modeTailwindBtn.addEventListener('click', () => renderPreview('tailwind'));
modeUniversalBtn?.addEventListener('click', () => renderPreview('universal'));

copyBtn.addEventListener('click', () => {
    const finalHtml = buildCopyPayload(currentMode);
    navigator.clipboard.writeText(finalHtml).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.style.background = '#22c55e';
        setTimeout(() => {
            copyBtn.textContent = 'Copy HTML';
            copyBtn.style.background = '';
        }, 1500);
    });
});

backBtn.addEventListener('click', () => window.close());

// --- Post-capture editor ----------------------------------------------------
// Lets the user edit the raw HTML (classes, ancestor selection, trimming
// children) before copying, and optionally save the edit back to the dock.
const editBtn = document.getElementById('edit-btn');
const editorPanel = document.getElementById('editor-panel');
const editorTextarea = document.getElementById('editor-textarea');
const editorApplyBtn = document.getElementById('editor-apply');
const editorSaveBtn = document.getElementById('editor-save');
const editorCloseBtn = document.getElementById('editor-close');

function openEditor() {
    editorTextarea.value = stolenHTML;
    editorPanel.classList.add('active');
    document.body.classList.add('editor-open');
    // Focus after animation frame so the layout shift is stable
    requestAnimationFrame(() => editorTextarea.focus());
}
function closeEditor() {
    editorPanel.classList.remove('active');
    document.body.classList.remove('editor-open');
}

editBtn?.addEventListener('click', () => {
    if (editorPanel.classList.contains('active')) closeEditor();
    else openEditor();
});
editorCloseBtn?.addEventListener('click', closeEditor);

editorApplyBtn?.addEventListener('click', () => {
    stolenHTML = editorTextarea.value;
    renderPreview(currentMode);
});

// Also apply on Cmd/Ctrl+Enter for keyboard users
editorTextarea?.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        stolenHTML = editorTextarea.value;
        renderPreview(currentMode);
    }
});

editorSaveBtn?.addEventListener('click', () => {
    const edited = editorTextarea.value;
    stolenHTML = edited;
    renderPreview(currentMode);

    // Persist back to the dock item (if we came from one)
    chrome.storage.local.get({ dockItems: [], previewItem: null }, (res) => {
        const targetId = res.previewItem?.id;
        if (!targetId) {
            editorSaveBtn.textContent = 'No dock item';
            setTimeout(() => { editorSaveBtn.textContent = 'Save to dock'; }, 1500);
            return;
        }
        const items = (res.dockItems || []).map(it =>
            it.id === targetId ? { ...it, html: edited } : it
        );
        chrome.storage.local.set({ dockItems: items, stolenHTML: edited }, () => {
            editorSaveBtn.textContent = 'Saved ✓';
            editorSaveBtn.style.background = '#22c55e';
            setTimeout(() => {
                editorSaveBtn.textContent = 'Save to dock';
                editorSaveBtn.style.background = '';
            }, 1500);
        });
    });
});
