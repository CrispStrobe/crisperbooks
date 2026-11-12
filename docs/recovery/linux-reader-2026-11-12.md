# Linux reader recovery evidence — 2026-11-12

## Successful enhanced host checkpoint

Revision `972c5c36576fbcc68cdf8d47c07617da57f23707` passed the real
Ubuntu 22.04 / WebKitGTK host job:

- [Fixed checkpoint workflow 43275492334](https://github.com/CrispStrobe/crisperbooks/actions/runs/43275492334)
- [Successful WebKitGTK job 131382647248](https://github.com/CrispStrobe/crisperbooks/actions/runs/43275492334/job/131382647248)
- Branch: `checkpoint/ebook-linux-972c5c3`

The job reported no analysis issues, passed all 12 reader package tests, and
completed the real Linux integration test in approximately 10 seconds. The
integration exercised actual WebKit pixels in Flutter's texture, a Flutter
overlay, keyboard selection with an EPUB CFI, system clipboard copying, a new
mouse-drag selection and its copied range, page turning, whole-book search,
Tab/Shift+Tab/Enter link activation, and escape from publication focus.

It also exercised resizing, interrupted startup, teardown and reuse, two
simultaneous readers, modal keyboard isolation, and blocking publication network
requests. The subsequent binary check found no hard WebKit/JavaScriptCore startup
dependency. After removing the optional WebKit runtime, the already-built app
launched and returned `available: false` with the missing-runtime reason.

## What changed after the prior failure

The saved selection-observer and native-navigation changes were already present
at `c7d2dcdd64665fd4bd28f6818c1083274aae8141`. Its retried enhanced-host job
passed keyboard selection, CFI creation and clipboard copying, then failed at
the mouse-drag assertion:

- [Prior workflow 43252008425, attempt 2](https://github.com/CrispStrobe/crisperbooks/actions/runs/43252008425/attempts/2)
- [Prior WebKitGTK job 131377486657](https://github.com/CrispStrobe/crisperbooks/actions/runs/43252008425/job/131377486657)

The smoke test began its drag immediately after Select All and started above
the visible paragraph. Dragging an existing selection can request native text
drag-and-drop. The stored framebuffer confirmed the first paragraph's glyphs
at approximately local y=120–135; the original gesture started at y=105.

The test now clears Select All through a native click, starts on the visible
first paragraph, and sends paced motion events. It still requires a new,
nonempty CFI. It additionally rejects the old Select All range and checks
that copying the dragged native range produces the same text. No C++ product
change or weakened selection assertion was required for this correction.

The same prior revision independently passed both recovery scenarios:

- [Portable-only job 131377486900](https://github.com/CrispStrobe/crisperbooks/actions/runs/43252008425/job/131377486900)
- [Blocked-runtime job 131377487156](https://github.com/CrispStrobe/crisperbooks/actions/runs/43252008425/job/131377487156)

## Final revision qualification still pending

The combined package checkpoint
`eb163b7c003ed34c1f5e78d694fcdcf07839cfba` has separate fixed runs:

- [Linux matrix 43276879460](https://github.com/CrispStrobe/crisperbooks/actions/runs/43276879460)
- [Package/platform matrix 43276879334](https://github.com/CrispStrobe/crisperbooks/actions/runs/43276879334)
- Branch: `feature/ebook-validation-eb163b7`

These runs were queued or still running when this evidence was recorded. A
successful earlier Linux checkpoint does not establish that every job at the
combined revision passed. Consult the exact run results before treating that
revision as qualified. This note makes no Android, iOS, macOS, Windows or browser
runtime claim.
