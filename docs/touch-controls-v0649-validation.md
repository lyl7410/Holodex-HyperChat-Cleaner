# Touch Controls v0.6.49 — direct mobile fullscreen shortcut

2026-11-05. Development branch `feat/android-landscape-fullscreen-v0642`, PR #11.

## Change

The mobile fullscreen action is visible without opening More. A script-owned
strip is appended directly to `document.body`, outside the Vue-owned toolbar.
It reserves 52px plus the safe-area top inset. A scoped CSS rule moves the
multiview down and reduces its viewport height by the same amount; no grid data
or saved layout settings are changed. This deliberately uses a small dedicated
row rather than squeezing the already crowded native toolbar.

The button has a minimum 128×44px touch target and supports portrait and
landscape enter/exit. Its states include “全屏”, “点此全屏”, “退出全屏” and
“重试全屏”. Only a trusted click issues the request. The precise original menu
item is hidden using CSS `:has()` only while the mobile strip is active; its DOM
node and native listener remain intact. Older browsers without `:has()` may
retain the duplicate menu entry. Leaving multiview or using desktop removes the
scoped class and hides the strip, restoring native spacing and menu visibility.

The existing saved landscape setting is retained, default off. Rotation arms
the visible “点此全屏” state; it does not call the Fullscreen API by itself.
Android browsers generally require transient user activation. Physical rotation
does not supply it, so automatic entry without a touch is not promised. Manually
exiting still suppresses immediate re-entry. Statistics, pause protection, LIVE
jump and the independent Quick Add PR #12 are preserved.

## Validation

- Read actual Holodex DOM: `.multiview` is a flex column with native
  `.mv-toolbar` as a child; the toolbar has a `.v-toolbar__content` child.
  At the inspected viewport it occupied y=0–64 and `.multiview` used the viewport
  height. No toolbar nodes were changed during inspection.
- The local browser fixture loads the production fullscreen module and forces
  only the mobile gate for desktop Chromium. Fullscreen API, trusted events and
  user activation are real; video is a placeholder, not a YouTube iframe.
- At a 430px-wide viewport, the strip occupied y≈0–52, native toolbar y≈52–116,
  video y≈132 onward, and the button measured ≈128×44px. No overlap with video.
- One direct button click in portrait entered root HTML fullscreen. After
  enabling preparation in portrait and resizing to 900×430, the state became
  pending without an extra request. Clicking the external “点此全屏” button then
  entered fullscreen in landscape. Both requests recorded activation=true.
- Native toolbar child mutations=0; native default fullscreen actions=0.
  The duplicate menu item remained in DOM (count=1) with computed display=none.
- `node --check userscripts/holodex-touch-controls.user.js` passes.
- `node --test tests/*.test.cjs`: **125/125** top-level tests pass, including the
  11 pause tests from v0.6.48 and a new strip ownership/spacing/cleanup test.
  The Recovery file's embedded black-box checks report 93/93.
- `git diff --check` passes.

The real Holodex site was inspected, but the modified strip's full behavior was
tested in a local layout fixture, not installed on live Holodex. Android Vivaldi,
physical rotation, Android Back, script-manager isolation, native dropdown
position after the reserved spacing, hidden-toolbar layouts, and actual video
resizing still need device verification. No claim of completed Android testing.

## Phone checks still required

1. Install v0.6.49 and refresh Holodex. Confirm the external fullscreen button is
   immediately visible and that no native toolbar controls or video are covered.
2. Tap it in portrait, exit with Android Back, then repeat in landscape.
3. Enable landscape preparation and rotate. Expect “点此全屏”; tap once to enter.
   After exiting, it must not immediately re-enter.
4. Check native dropdown positions, collapsed toolbar, layout changes, stats and
   red LIVE jump; quickly pause an automatically started video and wait 15s.

Keep PR #11 unmerged pending device acceptance. The development update URLs
remain pinned to the development branch; switch them to main for a stable release.
