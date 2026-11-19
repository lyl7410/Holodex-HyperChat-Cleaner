# Touch Controls v0.6.51 — landscape attempt and portrait restoration

2026-11-05, PR #11 / `feat/android-landscape-fullscreen-v0642`.

The user confirmed that v0.6.50's inline fullscreen shortcut works on a real
Android device. This release adds rotation automation; its new behavior has not
yet been tested on that Android device.

Enable “横屏自动尝试全屏／竖屏自动恢复” in Touch Controls settings, or use the
matching userscript menu command. The existing stored setting key is reused and
its default remains off. An already enabled setting remains enabled.

- Each portrait→landscape transition issues one silent, best-effort root
  Fullscreen API request. The browser decides whether it is allowed. No fake
  user activation, unrelated touch interception or timer retry loop is used.
- If rejected, the existing inline icon remains the one-touch fallback.
  Refreshing while already landscape does not force an automatic request.
- With the setting on, a fullscreen session entered in landscape (including a
  manual fallback) exits automatically on returning to portrait. Exit does not
  require user activation. A portrait manual fullscreen session is preserved.
- Turning the setting off retains manual fullscreen in either orientation and
  stops rotation entry/exit behavior. Android Back still suppresses re-entry
  during the same landscape cycle.
- A delayed enter completing after return to portrait is exited once it
  completes. Automatic exit failure gives recovery guidance without a repeated
  exit loop or alert. Other iframe/foreign fullscreen is left alone.
- On Android, `screen.orientation.type` takes precedence over viewport aspect
  ratio, avoiding browser-chrome height changes being mistaken for rotation.
  Legacy browsers fall back to viewport dimensions. Both orientation-change
  sources and existing resize reconciliation are supported.

The same-row icon, no-extra-top-row layout, statistics, LIVE jump, pause
protection and independent Quick Add scope are retained.

## Browser evidence

Desktop Chromium fixture loads the production fullscreen module and forces only
mobile-device detection. Real Fullscreen API, user activation and promises are
used; the video is a placeholder. Viewport resizing simulates orientation.

1. In portrait, clicking the setting and immediately resizing landscape left
   transient activation available: automatic request #1 recorded activation=true
   and entered root HTML fullscreen without clicking the fullscreen icon.
2. Resizing back portrait exited automatically: entered/exited events,
   fullscreenElement=null, pending=false, suppressed=false. UI reported
   “已恢复竖屏窗口模式”; the icon remained a normal entry control.
3. A later landscape transition without activation sent request #2,
   activation=false. The browser rejected it, no alert appeared, pending=true
   and the one-touch retry icon remained. This directly demonstrates why
   automatic entry cannot be promised on every rotation.
4. Clicking retry sent request #3 with activation=true and entered fullscreen;
   returning portrait exited automatically. Manual portrait fullscreen then
   remained active until explicitly exited.
5. Native toolbar child mutations and native default handler calls stayed zero.

JSON snapshots and a restored-portrait screenshot are saved with task outputs.

## Automated validation and limits

`node --check userscripts/holodex-touch-controls.user.js` passes.
`node --test tests/*.test.cjs`: **132/132** top-level tests pass (Recovery's
embedded black-box suite additionally reports 93/93). The new rotation tests
cover one-shot requests, rejection without polling, portrait restoration,
manual exceptions, foreign fullscreen, late-entry races, physical orientation
priority and automatic exit failure. `git diff --check` passes.

New automatic rotation behavior, physical Android rotation, Android Back, iframe
resizing and Vivaldi activation policy still need device validation. Manual
success on Android does not grant permanent permission for gesture-free entry.

## Device acceptance

Install v0.6.51 and refresh Holodex. Enable the setting in portrait. Rotate to
landscape; automatic entry may succeed while a recent page interaction remains
active. If rejected, click the existing full-screen icon once. Rotate portrait:
the landscape session should exit automatically. Repeat after several seconds
without touching the page, check portrait manual fullscreen is retained, and
check Android Back does not cause immediate re-entry. Keep PR #11 unmerged until
this new rotation behavior is confirmed on the device.
