# Touch Controls v0.6.50 — fullscreen beside native icons

2026-11-05, PR #11 / `feat/android-landscape-fullscreen-v0642`.

Replaces the v0.6.49 dedicated top strip at the user's request. There is no
additional top row, no 52px margin and no multiview height override. The 44×44px
fullscreen icon sits immediately before the pink layout icon in the native
right-hand toolbar group, alongside the four icons identified in the screenshot.

The actual button is a body-owned portal aligned to the existing toolbar's
measured bounds. Scoped CSS reserves a 48px horizontal slot in
`.mv-toolbar .mv-toolbar-btn.justify-end`. No native toolbar child is inserted,
removed or reparented, and no Vue state or saved grid data is changed.
At narrow widths the original icon group can scroll horizontally, with its
left slot clipped out so scrolling native icons cannot cover the fullscreen
button. The left Add Video group keeps at least its 44px space.

When the native toolbar is collapsed, scrolled out of view, missing, or cannot
provide a valid onscreen slot, the portal hides and the original fullscreen menu
entry becomes available. Scroll events, resize, orientation and existing route
reconciliation refresh the position. The exact original menu item is hidden by
CSS only while the new slot is active; its native DOM node remains.

## Validation

- Existing live Holodex DOM inspection identified the right-hand group as
  `.mv-toolbar-btn.justify-end`, its first button as the pink layout control,
  and the native header as a 64px row. The attached screenshot identifies the
  requested ordering; the new full-screen action precedes that group.
- Updated local browser fixture loads the production fullscreen module, forces
  only mobile-device detection, and uses real Fullscreen API and trusted clicks.
  It includes the left Menu/Add controls and the right native icon group.
- At 360px width: toolbar y≈0–64, fullscreen x≈102–146/y≈10–54,
  pink layout x≈148–184/y≈10–54, video y≈80 onward. The icon is on the same row,
  precedes pink by a 2px gap, and does not overlap video or the left Add control.
- One direct click entered HTML fullscreen in portrait. A second direct click
  after exiting and switching to 900×430 also entered fullscreen. Both requests
  recorded activation=true; toolbar child mutations=0; native default calls=0.
- Scrolling the narrow native icon group to reach More left the fullscreen
  button's center hit-test mapped to its own “进入全屏” control.
- `node --check userscripts/holodex-touch-controls.user.js`: pass.
- `node --test tests/*.test.cjs`: **125/125** top-level tests pass (Recovery's
  embedded black-box suite additionally reports 93/93).
- Updated production-module regression checks cover body ownership, horizontal
  spacing, absence of top margin/height changes, trusted click, hidden/scrolled
  toolbar fallback and route cleanup. Existing pause/statistics/LIVE tests remain.

The browser validation is a local fixture, not the installed userscript running
on live Holodex. Android Vivaldi, actual iframe sizing, native tooltips/dropdown
position, and the real toolbar's responsive/collapse transitions still require
device acceptance. No physical Android test is claimed. A real in-page touch is
still required for reliable fullscreen; rotation alone is not promised to enter.

Install v0.6.50 and refresh Holodex. Check the new icon directly before the pink
layout control in both orientations, narrow-width scrolling, native menus and
toolbar collapse, then quickly pause an automatically started stream and verify
it remains paused. Quick Add is unchanged and remains in independent PR #12.
Keep PR #11 unmerged pending phone acceptance.
