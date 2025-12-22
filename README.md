# ⚡ EasyDiv - Tailwind Component Stealer

A Chrome extension that lets you "steal" any UI component from any website and get clean, pixel-perfect Tailwind CSS code instantly.

## Features

- 🎯 **Visual Inspector** - Click on any element to capture it
- 🎨 **Tailwind CSS Generation** - Converts computed styles to Tailwind utility classes
- 📦 **Component Dock** - Store up to 20 captured components
- 👁️ **Live Preview** - Preview components with Tailwind CDN
- 📋 **One-Click Copy** - Copy clean HTML with Tailwind classes
- 🛡️ **Smart Sanitization** - Removes auth-protected links, scripts, and junk attributes
- 🖼️ **Canvas Handling** - Detects canvas elements and creates placeholders
- 🔗 **Asset Fixing** - Converts relative URLs to absolute URLs

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `easydiv` folder
5. The extension icon will appear in your toolbar

## Usage

1. Click the EasyDiv extension icon
2. Click **Start Inspector**
3. Hover over any element on the page - it will be highlighted
4. Click to capture the element
5. View your captured components in the popup dock
6. Click **Copy** to copy the Tailwind HTML
7. Click **👁️** to open a full preview
8. Press **Escape** to deactivate the inspector

## File Structure

```
easydiv/
├── manifest.json      # Extension configuration
├── content.js         # Tailwind engine & DOM cloner
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic & dock management
├── preview.html       # Full-page preview
├── preview.js         # Preview page logic
├── icons/             # Extension icons
└── README.md          # This file
```

## How It Works

### Tailwind Mapping Engine
The extension uses `getComputedStyle()` to read the actual rendered CSS of any element, then converts those values to Tailwind utility classes:

- **Keyword properties** (display, position, flex-direction) → Standard Tailwind classes
- **Dimensional values** (width, padding, margin) → Arbitrary values like `w-[350px]`
- **Colors** → Arbitrary colors like `bg-[rgb(26,26,26)]`

### Smart Cloning
- Skips invisible elements (prevents bloat)
- Handles canvas elements with placeholders
- Preserves SVG elements
- Converts images/links to absolute URLs
- Removes junk attributes (data-testid, React IDs, etc.)

### Auth-Bridge Protection
Automatically removes stylesheet links that point to auth-protected URLs (like Lovable.dev's auth-bridge) to prevent MIME type errors.

## Notes

- The preview uses Tailwind CDN, so all generated classes work instantly
- Interactive states (`:hover`, `:focus`) are not captured - the extension captures a snapshot
- JavaScript animations and canvas content cannot be stolen
- Some sites may have Content Security Policies that block the extension

## Tech Stack

- Manifest V3
- Chrome Storage API
- Shadow DOM for isolated previews
- Tailwind CSS CDN

## License

MIT
