// DOM Elements
const toggleBtn = document.getElementById("toggleBtn");
const clearBtn = document.getElementById("clearBtn");
const dockList = document.getElementById("dockList");

let isInspecting = false;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    renderDock();
    checkInspectorStatus();
});

// Check if inspector is currently active
async function checkInspectorStatus() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "getStatus" }, (response) => {
                if (response && response.isActive) {
                    isInspecting = true;
                    updateToggleButton();
                }
            });
        }
    } catch (err) {
        console.log("Could not check inspector status:", err);
    }
}

// Toggle Inspector
toggleBtn.addEventListener("click", async () => {
    isInspecting = !isInspecting;
    updateToggleButton();

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, {
                action: "toggleInspection",
                isActive: isInspecting
            });
        }
    } catch (err) {
        console.error("Error toggling inspector:", err);
        showToast("Error: Could not activate inspector", "error");
    }
});

function updateToggleButton() {
    if (isInspecting) {
        toggleBtn.classList.add("active");
        toggleBtn.innerHTML = '<span>✅</span> Inspector Active';
    } else {
        toggleBtn.classList.remove("active");
        toggleBtn.innerHTML = '<span>🎯</span> Start Inspector';
    }
}

// Clear All Items
clearBtn.addEventListener("click", () => {
    if (confirm("Clear all captured components?")) {
        chrome.storage.local.set({ dockItems: [] }, () => {
            renderDock();
            showToast("All items cleared!");
        });
    }
});

// Render Dock Items
function renderDock() {
    chrome.storage.local.get({ dockItems: [] }, (result) => {
        const items = result.dockItems;

        if (items.length === 0) {
            dockList.innerHTML = `
        <div class="empty-state">
          <div class="icon">📦</div>
          <h3>No components yet</h3>
          <p>Click "Start Inspector" then click on any element on a webpage to capture it with Tailwind CSS classes.</p>
        </div>
      `;
            return;
        }

        dockList.innerHTML = items.map((item, index) => `
      <div class="dock-item" data-id="${item.id}">
        <div class="dock-item-header">
          <div class="dock-item-meta">
            <span class="dock-item-source">${item.source}</span>
            <span class="dock-item-time">${item.timestamp}</span>
          </div>
          <div class="dock-item-actions">
            <button class="btn-copy" data-index="${index}" title="Copy HTML">📋 Copy</button>
            <button class="btn-preview" data-index="${index}" title="Open Preview">👁️</button>
            <button class="btn-delete" data-index="${index}" title="Delete">✕</button>
          </div>
        </div>
        <div class="preview-container">
          <div class="preview-root" data-index="${index}"></div>
          <div class="preview-overlay"></div>
        </div>
      </div>
    `).join("");

        // Render previews with Shadow DOM + Tailwind CDN
        items.forEach((item, index) => {
            const previewRoot = dockList.querySelector(`.preview-root[data-index="${index}"]`);
            if (previewRoot) {
                const shadow = previewRoot.attachShadow({ mode: "open" });

                // Inject Tailwind CDN so the classes actually work in the preview
                shadow.innerHTML = `
          <script src="https://cdn.tailwindcss.com"><\/script>
          <style>
            :host {
              all: initial;
              display: block;
            }
            * {
              max-width: 100% !important;
            }
          </style>
          <div style="transform: scale(0.5); transform-origin: top left; display: inline-block;">
            ${item.html} 
          </div>
        `;
            }
        });

        // Attach event listeners
        attachItemListeners(items);
    });
}

function attachItemListeners(items) {
    // Copy buttons
    document.querySelectorAll(".btn-copy").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const index = parseInt(e.target.dataset.index);
            const html = items[index].html;

            navigator.clipboard.writeText(html).then(() => {
                showToast("Copied to clipboard!");
                e.target.textContent = "✓ Copied";
                setTimeout(() => {
                    e.target.textContent = "📋 Copy";
                }, 1500);
            }).catch(err => {
                console.error("Copy failed:", err);
                showToast("Failed to copy", "error");
            });
        });
    });

    // Preview buttons
    document.querySelectorAll(".btn-preview").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const index = parseInt(e.target.dataset.index);
            const item = items[index];

            // Store the item for the preview page
            chrome.storage.local.set({ previewItem: item }, () => {
                chrome.tabs.create({ url: "preview.html" });
            });
        });
    });

    // Delete buttons
    document.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const index = parseInt(e.target.dataset.index);
            items.splice(index, 1);

            chrome.storage.local.set({ dockItems: items }, () => {
                renderDock();
                showToast("Item deleted");
            });
        });
    });
}

// Toast notification
function showToast(message, type = "success") {
    // Remove existing toast
    const existingToast = document.querySelector(".toast");
    if (existingToast) existingToast.remove();

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    if (type === "error") {
        toast.style.background = "#ef4444";
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-50%) translateY(10px)";
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Listen for storage changes to update dock in real-time
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.dockItems) {
        renderDock();
    }
});
