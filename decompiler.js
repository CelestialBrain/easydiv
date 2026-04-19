// EasyDiv Extension Inspector
//
// Fetches any publicly-listed Chrome Web Store extension's CRX, strips the
// CRX3 header, walks the inner ZIP via a tiny native parser (uses
// DecompressionStream for deflate — no dependencies), and shows file tree +
// syntax-unstyled source.
//
// Scope: read-only, clientside. We don't verify signatures or parse the
// protobuf header; we just skip past it.

const idInput = document.getElementById('id-input');
const fetchBtn = document.getElementById('fetch');
const statusEl = document.getElementById('status');
const treeEl = document.getElementById('tree');
const viewerHeader = document.getElementById('viewer-header');
const viewerPath = document.getElementById('viewer-path');
const viewerSize = document.getElementById('viewer-size');
const viewerCopyBtn = document.getElementById('viewer-copy');
const viewerEl = document.getElementById('viewer');

const EXTENSION_ID_RE = /^[a-p]{32}$/;
let currentEntries = [];      // [{ name, dataOffset, compMethod, compSize, uncompSize }]
let currentBuffer = null;     // ArrayBuffer of inner ZIP
let currentFilename = '';

function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = kind || '';
}

function extractIdFromInput(raw) {
    const text = raw.trim();
    // CWS URL: https://chromewebstore.google.com/detail/<slug>/<id> (or old chrome.google.com)
    const urlMatch = text.match(/\/detail\/(?:[^/]+\/)?([a-p]{32})/);
    if (urlMatch) return urlMatch[1];
    if (EXTENSION_ID_RE.test(text)) return text;
    return null;
}

function crxDownloadUrl(id) {
    // Chrome's public update endpoint. Returns a 302 → CRX binary.
    return 'https://clients2.google.com/service/update2/crx?response=redirect' +
        '&prodversion=120&acceptformat=crx2,crx3' +
        `&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

// --- CRX header stripping ----------------------------------------------------
// CRX2: "Cr24" | ver=2 | pubKeyLen | sigLen | pubKey | sig | ZIP
// CRX3: "Cr24" | ver=3 | headerLen | header(protobuf) | ZIP
function stripCrxHeader(buffer) {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    // "Cr24" little-endian = 0x34327243
    if (magic !== 0x34327243) throw new Error('Not a CRX file (bad magic)');
    const version = view.getUint32(4, true);
    if (version === 2) {
        const pkLen = view.getUint32(8, true);
        const sigLen = view.getUint32(12, true);
        return buffer.slice(16 + pkLen + sigLen);
    }
    if (version === 3) {
        const headerLen = view.getUint32(8, true);
        return buffer.slice(12 + headerLen);
    }
    throw new Error('Unsupported CRX version: ' + version);
}

// --- Minimal ZIP reader (EOCD → central directory → entries) -----------------
// Supports stored (0) and deflate (8). Anything else throws on extract.
// Uses DecompressionStream('deflate-raw') so we don't ship a decompressor.
function parseZipDirectory(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    // End-of-Central-Directory signature: 0x06054b50. Up to 64KB of trailing
    // comment possible, so scan backwards from end.
    const maxSearch = Math.min(bytes.length, 0x10000 + 22);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - maxSearch); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Central directory not found — invalid ZIP');

    const cdCount = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);

    const entries = [];
    let off = cdOffset;
    for (let i = 0; i < cdCount; i++) {
        if (view.getUint32(off, true) !== 0x02014b50) break; // central file header
        const compMethod = view.getUint16(off + 10, true);
        const compSize = view.getUint32(off + 20, true);
        const uncompSize = view.getUint32(off + 24, true);
        const nameLen = view.getUint16(off + 28, true);
        const extraLen = view.getUint16(off + 30, true);
        const commentLen = view.getUint16(off + 32, true);
        const localOffset = view.getUint32(off + 42, true);
        const name = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + nameLen));

        // Resolve actual data offset via the local header (has its own name/extra lens)
        let dataOffset = localOffset;
        if (view.getUint32(localOffset, true) === 0x04034b50) {
            const lhNameLen = view.getUint16(localOffset + 26, true);
            const lhExtraLen = view.getUint16(localOffset + 28, true);
            dataOffset = localOffset + 30 + lhNameLen + lhExtraLen;
        }

        entries.push({ name, compMethod, compSize, uncompSize, dataOffset });
        off += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

async function extractEntry(buffer, entry) {
    const raw = buffer.slice(entry.dataOffset, entry.dataOffset + entry.compSize);
    if (entry.compMethod === 0) return raw;
    if (entry.compMethod === 8) {
        const stream = new Response(raw).body.pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).arrayBuffer();
    }
    throw new Error('Unsupported compression method: ' + entry.compMethod);
}

// --- File tree rendering -----------------------------------------------------
function buildTree(entries) {
    const root = { name: '', dir: true, children: {}, entry: null };
    for (const e of entries) {
        if (e.name.endsWith('/')) continue; // directory marker, skip
        const parts = e.name.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!node.children[p]) node.children[p] = { name: p, dir: true, children: {}, entry: null };
            node = node.children[p];
        }
        const leaf = parts[parts.length - 1];
        node.children[leaf] = { name: leaf, dir: false, children: {}, entry: e };
    }
    return root;
}

function formatBytes(n) {
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function sortedEntries(children) {
    return Object.entries(children).sort(([a, A], [b, B]) => {
        if (A.dir !== B.dir) return A.dir ? -1 : 1;
        return a.localeCompare(b);
    });
}

function renderTree(root) {
    treeEl.innerHTML = '';
    function walk(node, depth) {
        for (const [, child] of sortedEntries(node.children)) {
            const div = document.createElement('div');
            div.className = 'tree-node' + (child.dir ? ' folder' : '');
            div.style.paddingLeft = `${10 + depth * 14}px`;
            const icon = child.dir ? '📁' : '📄';
            div.textContent = `${icon} ${child.name}`;
            if (!child.dir && child.entry) {
                const size = document.createElement('span');
                size.className = 'tree-size';
                size.textContent = formatBytes(child.entry.uncompSize);
                div.appendChild(size);
                div.addEventListener('click', () => selectFile(child.entry, div));
            }
            treeEl.appendChild(div);
            if (child.dir) walk(child, depth + 1);
        }
    }
    walk(root, 0);
}

async function selectFile(entry, nodeEl) {
    document.querySelectorAll('.tree-node.active').forEach(n => n.classList.remove('active'));
    if (nodeEl) nodeEl.classList.add('active');

    viewerHeader.style.display = 'flex';
    viewerPath.textContent = entry.name;
    viewerSize.textContent = `${formatBytes(entry.uncompSize)} · ${entry.compMethod === 0 ? 'stored' : 'deflate'}`;

    try {
        const buf = await extractEntry(currentBuffer, entry);
        // Decide: text vs binary
        const isBinaryExt = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp3|mp4|wav|pdf)$/i.test(entry.name);
        if (isBinaryExt || entry.uncompSize > 2_000_000) {
            viewerEl.innerHTML = `<div class="viewer-empty">
                Binary or oversized file (${formatBytes(entry.uncompSize)}). Not rendered.
            </div>`;
            return;
        }
        const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
        viewerEl.textContent = text;
    } catch (e) {
        viewerEl.innerHTML = `<div class="viewer-empty">Decompress error: ${e.message}</div>`;
    }
}

// --- manifest summary --------------------------------------------------------
async function showManifestSummary(entries) {
    const manifestEntry = entries.find(e => e.name === 'manifest.json');
    if (!manifestEntry) return;
    try {
        const buf = await extractEntry(currentBuffer, manifestEntry);
        const text = new TextDecoder().decode(new Uint8Array(buf));
        const manifest = JSON.parse(text);

        // Resolve i18n message placeholders where possible
        let name = manifest.name || '(unknown)';
        let description = manifest.description || '';
        if (typeof name === 'string' && name.startsWith('__MSG_')) {
            const key = name.slice(6, -2);
            const locale = manifest.default_locale || 'en';
            const msgEntry = entries.find(e => e.name === `_locales/${locale}/messages.json`);
            if (msgEntry) {
                try {
                    const mBuf = await extractEntry(currentBuffer, msgEntry);
                    const msgs = JSON.parse(new TextDecoder().decode(new Uint8Array(mBuf)));
                    if (msgs[key]?.message) name = msgs[key].message;
                } catch {}
            }
        }

        const dangerousPerms = new Set(['tabs', 'activeTab', 'webRequest', 'cookies', 'storage', '<all_urls>']);
        const perms = [...(manifest.permissions || []), ...(manifest.host_permissions || [])];

        const summary = document.createElement('div');
        summary.className = 'summary';
        summary.innerHTML = `
            <h3>${name} <span style="color:var(--text-2);font-weight:400;font-size:11px;">v${manifest.version || '?'}</span></h3>
            <div class="summary-line" style="color:var(--text-2);">${description}</div>
            <div class="summary-line">
                <strong>Manifest:</strong> v${manifest.manifest_version || '?'} &nbsp;·&nbsp;
                <strong>Files:</strong> ${entries.length} &nbsp;·&nbsp;
                <strong>Has devtools page:</strong> ${manifest.devtools_page ? 'yes' : 'no'}
            </div>
            ${perms.length ? `<div class="summary-line"><strong>Permissions:</strong><br>${perms.map(p => `<span class="summary-tag ${dangerousPerms.has(p) || p.includes('://') ? 'warn' : ''}">${p}</span>`).join(' ')}</div>` : ''}
            ${manifest.content_scripts ? `<div class="summary-line"><strong>Content scripts:</strong> ${manifest.content_scripts.length} matcher(s), injected on ${manifest.content_scripts.map(cs => cs.matches?.join(', ')).join(' / ')}</div>` : ''}
        `;
        viewerEl.innerHTML = '';
        viewerEl.appendChild(summary);
        const hint = document.createElement('div');
        hint.className = 'viewer-empty';
        hint.style.whiteSpace = 'normal';
        hint.textContent = 'Click any file on the left to view its source.';
        viewerEl.appendChild(hint);
        viewerHeader.style.display = 'none';
    } catch (e) {
        console.warn('manifest summary failed', e);
    }
}

// --- wire up -----------------------------------------------------------------
async function doFetch() {
    const id = extractIdFromInput(idInput.value);
    if (!id) {
        setStatus('Could not recognize extension ID. Paste a Chrome Web Store URL or a 32-char id.', 'err');
        return;
    }
    setStatus(`Fetching CRX for ${id}…`);
    fetchBtn.disabled = true;
    try {
        const url = crxDownloadUrl(id);
        const resp = await fetch(url, { credentials: 'omit' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const crxBuf = await resp.arrayBuffer();
        setStatus(`Got ${formatBytes(crxBuf.byteLength)}. Stripping CRX header…`);
        const zipBuf = stripCrxHeader(crxBuf);
        setStatus('Parsing ZIP directory…');
        const entries = parseZipDirectory(zipBuf);
        currentEntries = entries;
        currentBuffer = zipBuf;
        currentFilename = `${id}.crx`;
        renderTree(buildTree(entries));
        await showManifestSummary(entries);
        setStatus(`Loaded ${entries.length} files (${formatBytes(crxBuf.byteLength)}). Ready to inspect.`, 'ok');
    } catch (e) {
        setStatus('Failed: ' + e.message, 'err');
        console.error(e);
    } finally {
        fetchBtn.disabled = false;
    }
}

fetchBtn.addEventListener('click', doFetch);
idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFetch(); });
viewerCopyBtn.addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(viewerEl.textContent);
        const orig = viewerCopyBtn.textContent;
        viewerCopyBtn.textContent = 'Copied';
        setTimeout(() => { viewerCopyBtn.textContent = orig; }, 1200);
    } catch (e) {
        setStatus('Copy failed: ' + e.message, 'err');
    }
});

// Optional: if opened with ?id=<extensionId>, auto-fetch.
(() => {
    const params = new URLSearchParams(window.location.search);
    const pre = params.get('id');
    if (pre) { idInput.value = pre; doFetch(); }
})();
