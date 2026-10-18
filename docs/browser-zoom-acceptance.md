# Browser zoom acceptance (#15)

Run `npx playwright test e2e/browser-zoom.spec.ts`. The test loads only a
test-owned extension into a disposable, automatically removed Chromium profile.
It never uses an installed Chrome profile or changes a user's zoom preferences.

The extension's inert service worker provides Chrome's
[tabs.setZoom/getZoom](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom)
API: assert zoom factor 2 and a reduced CSS layout viewport. This is not a CSS
transform, pinch zoom, device scale-factor override, or viewport-only simulation.
The [official Playwright extension setup](https://playwright.dev/docs/chrome-extensions)
uses bundled Chromium with its `chromium` channel for headless extensions.

The fixture supplies a very long canonical repository name. Both Architecture
and Code Graph headings/topbar controls must remain horizontally in-bounds.
Viewport screenshots preserve the physical zoomed view in the test output directory.
Existing responsive tests separately cover 320, 390, 480, 768 and 1440px.
