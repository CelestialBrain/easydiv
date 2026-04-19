// Creates the EasyDiv panel inside Chrome DevTools. The panel renders
// popup.html — same UI as the toolbar popup, with the same scrape/inspect
// controls. Users can keep it pinned while iterating on a page.
chrome.devtools.panels.create(
    'EasyDiv',
    'icons/icon48.png',
    'popup.html',
    (panel) => {
        // Nothing to do on creation; the panel hosts popup.html directly.
        // Hook into show/hide later if we want per-panel lifecycle behavior.
    }
);
