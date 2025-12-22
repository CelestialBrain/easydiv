// DOM Elements
const previewFrame = document.getElementById("previewFrame");
const codeDisplay = document.getElementById("codeDisplay").querySelector("code");
const sourceBadge = document.getElementById("sourceBadge");
const previewContainer = document.getElementById("previewContainer");
const codeContainer = document.getElementById("codeContainer");
const viewPreviewBtn = document.getElementById("viewPreview");
const viewCodeBtn = document.getElementById("viewCode");
const copyBtn = document.getElementById("copyBtn");
const copyCodeBtn = document.getElementById("copyCodeBtn");
const backBtn = document.getElementById("backBtn");

let currentHTML = "";

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    loadPreviewItem();
    setupEventListeners();
});

function loadPreviewItem() {
    chrome.storage.local.get({ previewItem: null }, (result) => {
        const item = result.previewItem;

        if (!item) {
            showEmptyState();
            return;
        }

        currentHTML = item.html;
        sourceBadge.textContent = item.source;

        // Sanitize HTML - remove auth-bridge and login links
        let sanitizedHTML = sanitizeHTML(currentHTML);

        // Render preview
        previewFrame.innerHTML = sanitizedHTML;

        // Render code with syntax highlighting
        codeDisplay.innerHTML = formatHTMLForDisplay(sanitizedHTML);
    });
}

function sanitizeHTML(html) {
    // Create a temporary container
    const temp = document.createElement("div");
    temp.innerHTML = html;

    // Remove problematic links (auth-bridge, login redirects, relative paths)
    const links = temp.querySelectorAll('link[rel="stylesheet"]');
    links.forEach(link => {
        const href = link.getAttribute("href") || "";
        if (
            href.includes("auth-bridge") ||
            href.includes("login") ||
            href.startsWith("/") ||
            !href.startsWith("http")
        ) {
            link.remove();
        }
    });

    // Remove script tags
    temp.querySelectorAll("script").forEach(s => s.remove());

    // Remove inline event handlers
    const allElements = temp.querySelectorAll("*");
    allElements.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith("on")) {
                el.removeAttribute(attr.name);
            }
        });
    });

    return temp.innerHTML;
}

function formatHTMLForDisplay(html) {
    // Basic syntax highlighting
    return html
        // Escape HTML entities first
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        // Then apply highlighting
        .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tag">$2</span>')
        .replace(/([\w-]+)=("[^"]*")/g, '<span class="attr">$1</span>=<span class="string">$2</span>')
        .replace(/(&lt;!--.*?--&gt;)/g, '<span class="comment">$1</span>');
}

function showEmptyState() {
    previewFrame.innerHTML = `
    <div class="empty-state">
      <h2>No component to preview</h2>
      <p>Capture a component from a webpage first</p>
    </div>
  `;
}

function setupEventListeners() {
    // View toggle
    viewPreviewBtn.addEventListener("click", () => {
        viewPreviewBtn.classList.add("active");
        viewCodeBtn.classList.remove("active");
        previewContainer.classList.add("active");
        codeContainer.classList.remove("active");
    });

    viewCodeBtn.addEventListener("click", () => {
        viewCodeBtn.classList.add("active");
        viewPreviewBtn.classList.remove("active");
        codeContainer.classList.add("active");
        previewContainer.classList.remove("active");
    });

    // Copy buttons
    copyBtn.addEventListener("click", copyToClipboard);
    copyCodeBtn.addEventListener("click", copyToClipboard);

    // Back button
    backBtn.addEventListener("click", () => {
        window.close();
    });
}

function copyToClipboard() {
    navigator.clipboard.writeText(currentHTML).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = "✓ Copied!";
        btn.style.background = "#22c55e";
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = "";
        }, 1500);
    }).catch(err => {
        console.error("Copy failed:", err);
        alert("Failed to copy to clipboard");
    });
}
