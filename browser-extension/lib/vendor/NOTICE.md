# Vendor: @mozilla/readability

- Package: `@mozilla/readability` (Firefox Reader Mode engine)
- License: Apache-2.0
- Upstream: https://github.com/mozilla/readability
- Sync: `npm run extension:pack` copies from `topmind-desktop/node_modules/@mozilla/readability/Readability.js` when available

topmind adds a `globalThis.Readability` export for `chrome.scripting.executeScript` injection.
