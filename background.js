// Store the state of the inspector for each tab
const inspectionState = {};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleInspection") {
        const tabId = request.tabId;
        const newState = !inspectionState[tabId];
        inspectionState[tabId] = newState;

        // Send message to content script to toggle the inspector UI
        chrome.tabs.sendMessage(tabId, { action: "toggleInspection", isActive: newState });

        sendResponse({ isActive: newState });
    }

    if (request.action === "getInspectionState") {
        const tabId = request.tabId;
        sendResponse({ isActive: inspectionState[tabId] || false });
    }

    return true; // Keep channel open for async
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    delete inspectionState[tabId];
});
