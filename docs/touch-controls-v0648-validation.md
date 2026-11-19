# Touch Controls v0.6.48 validation — 2026-11-05

Development branch: `feat/android-landscape-fullscreen-v0642`, PR #11.
This is a test version. Android Vivaldi and the installed userscript on the live
site have **not** been tested end to end. Quick Add remains separate in PR #12.

## Live Holodex DOM inspection

Inspected `https://holodex.net/multiview` in desktop Chromium through the in-app
browser, including its narrow layout and a 900 × 430 landscape viewport.

- The native multiview header is `header.mv-toolbar`, with `.v-toolbar__content`
  and `.mv-toolbar-btn` children controlled by Vue/Vuetify.
- Its existing vertical-ellipsis button has `aria-haspopup="true"` and toggles
  `aria-expanded`. The opened portal is `.v-menu__content[role="menu"]`.
- Native entries have `role="menuitem"`. The actual menu included “储存目前布局”,
  “清空”, and “全屏显示”. The fullscreen entry contained this SVG path:

  ```text
  M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z
  ```

- In the measured landscape layout the toolbar occupied y=0–64 and the video
  frame began near y=70.5. The existing dropdown temporarily opens over page
  content, as native menus normally do; no persistent control is added on video.
- A click on the unmodified native fullscreen entry did not yield a confirmed
  `document.fullscreenElement` in this desktop inspection. This observation
  does not establish why it failed or predict Android behavior.

The adapter reuses **only** a trusted click on that menu role plus exact glyph.
It performs the Fullscreen API call synchronously, prevents the native action
from double-toggling, and asks the existing ellipsis activator to close its own
menu. It does not insert, remove, restyle or replace any native toolbar children,
write Vue state, modify the layout, or create a video overlay. If the native
markup changes, it leaves unrecognized controls alone; the script settings
button remains available. Opening ⋮ is one action; the fullscreen menu item then
requires one touch. This is **not a one-touch shortcut from a closed menu**.

## Browser API validation using the production fullscreen module

Run `node tests/fullscreen-browser-harness.cjs` and open the printed local URL.
The fixture reproduces the inspected menu roles/glyphs and loads the production
fullscreen module. It forces only the mobile-device gate to true for desktop
testing. Fullscreen API, DOM events, user activation and promises are real.
The video is a placeholder; this is not the Holodex app or a userscript manager.

Observed in the browser:

| Action | Evidence |
| --- | --- |
| Menu-item click with preparation off | Exactly one request, activation=true, fullscreenElement=HTML, native handler count=0, toolbar child mutations=0 |
| Exit | fullscreenchange=exited, fullscreenElement=null |
| Enable preparation in portrait, then resize to landscape | No additional request; pending=true, fullscreenElement=null |
| Native menu click in landscape | Second request, activation=true, entered event; menu closed |
| Explicit exit while preparation remains enabled | pending=false, suppressed=true; no automatic re-entry |
| Portrait manual fullscreen with preparation off | Third request, activation=true, fullscreenElement=HTML |

Screenshots and JSON snapshots were saved with the local task deliverables.
Neither Android Back, Vivaldi browser chrome, physical rotation nor Tampermonkey
realm behavior was verified on a device. No Android device was connected.

## Automated regression tests

- `node --check userscripts/holodex-touch-controls.user.js`: pass.
- `node --check tests/fullscreen-browser-harness.cjs`: pass.
- `node --test tests/*.test.cjs`: **124/124 top-level tests pass**. The Recovery
  test file additionally reports its embedded black-box checks as **93/93**.
- `git diff --check`: pass.
- 11 new autoplay cases execute the production autoplay module with virtual
  time, Vue-cell substitutes and named YouTube callback strings. They cover fast
  pause between scans, buffering→pause, autoplay denial, no-event fallback,
  manual resume and force play, respect-pause off, delayed muted starts,
  removed players, background return, reload persistence and master-off.
- These tests exposed and fixed two edges: disabling respect-pause failed to
  release residual pending/confirmed protection; PLAYING after tab return did
  not promptly reset the background-pause exception.
- 9 fullscreen cases cover native synchronous activation, unrelated/untrusted
  clicks, rotation/reload, rejection/throw/unconfirmed results, unsupported and
  foreign fullscreen, persistent portrait error feedback, duplicate requests,
  exit suppression, off/route state, and absence of native DOM writes.
- Four outdated desktop-test fixtures were repaired (missing init dependencies,
  a missing panel query method, lexical HUD access, and an obsolete background
  tap test). Production statistics, LIVE jump and quality behavior remain covered.

Pause inference uses YouTube PLAYING/PAUSED state events plus a short confirmation
window, not an authenticated report of which human action caused each pause.
Real iframe event ordering and browser autoplay policy still need device testing.

## Fullscreen contract and settings

Fullscreen requests normally require transient user activation. Rotation,
refreshing, timers and a script-manager menu cannot create that activation.
See [Fullscreen Standard](https://fullscreen.spec.whatwg.org/#dom-element-requestfullscreen)
and [MDN requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen#security).

The existing stored key `hmtc_landscape_auto_fullscreen_v1` and default **off**
are retained. UI calls it “横屏全屏准备（仍需触摸入口）”. Rotation arms a pending
state; unrelated page/video taps do nothing. Explicit enabling from an active
in-page checkbox in landscape may request fullscreen in that same gesture.
Disabling clears pending state and leaves manual fullscreen usable in either
orientation. Exit suppresses automatic preparation until a fresh orientation or
route cycle, or an explicit setting change. Failures keep retry guidance visible;
only confirmed root fullscreen is reported as success.

The development userscript's update/download URLs point to this development
branch so installing it does not silently switch back to main. Reset those URLs
to main when preparing a future stable merge/release.

## Android Vivaldi acceptance checklist (not yet performed)

1. Install v0.6.48, refresh Holodex, open native ⋮, tap “全屏显示”. Check that the
   browser bars hide and the video remains unobstructed after the menu closes.
2. Exit using Android Back; confirm there is no immediate re-entry. Repeat in
   portrait with preparation off. Also check the script settings button.
3. Enable preparation, rotate portrait→landscape. Confirm it waits for a real
   touch rather than repeatedly attempting fullscreen in the background.
4. Refresh with autoplay on; immediately pause an automatically started stream.
   Wait at least 15 seconds and touch unrelated controls: it should stay paused.
5. Resume that stream manually, pause it again, and repeat after switching tabs.
6. Verify browser-denied initial playback is diagnosed as blocked, and manually
   paused streams are not restarted by enabling mute fallback.
7. Check red LIVE latency-row jump, statistics and native quality/menu controls.

Keep PR #11 unmerged until this device acceptance is complete.
