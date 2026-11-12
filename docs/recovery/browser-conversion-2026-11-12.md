# Browser Kindle conversion recovery — 12 November 2026

The recovered source is saved on `feature/ebook-reader-editor`. The key remote
checkpoints are `dac2985` (pinned runtime/build inputs), `c8c4123` (memory-only
runtime), `e74c1ca` (compressed engine and provenance), `e5a64a3` (Dart adapter
and regression gates), and `b5b698b` (CI integration and documentation).

## Implemented behavior

The browser exports EPUB to AZW3/KF8 or dual KF7/KF8 MOBI with the same native
Kindling request processor, archive checks, CSS validation and output checks.
It also edits Kindle metadata. Each operation has a fresh worker, private input
snapshot and memory-only `/job`. Cancellation and timeout terminate that worker.
No host filesystem, OPFS, socket or external conversion service is exposed.
Cover replacement remains a native-only capability.

The WASI build uses the existing sequential compression path on large books;
the native build keeps its threaded path. The only native adapter conditional
requires the exact private `/job` path in WASI because Preview 1 cannot perform
host path canonicalization. Native canonicalization remains in place.

The full Wasm is 4,780,479 bytes and its deterministic gzip asset is 1,332,168
bytes. `CONVERSION_WASM.json` records both hashes, source/build inputs and the
512 MiB linear-memory ceiling. `WASI_SHIM.json` pins unmodified runtime modules
from `@bjorn3/browser_wasi_shim` 0.4.2 with its MIT-selected grant. The license
inventory covers 126 Cargo packages and that browser runtime. Nested runtime
assets are explicitly included in the package pubspec.

## Local verification

These results cover the code in the checkpoints above. Documentation and Dart
formatting changes do not change that tested behavior.

| Gate | Observed result |
| --- | --- |
| Converter Dart analysis | No issues in `lib` or the compiled worker probe. |
| Native Rust bridge tests | 4 passed, including CSS grammar and resource confinement checks. |
| Native Dart converter suite | All 27 tests passed with the freshly built native library; the temporary local hook override was restored afterward. |
| Native independent smoke | Both export formats, legacy TOC, metadata, source preservation, DRM and archive/image budgets passed. |
| Full conversion Wasm | Complete native/Wasm output bytes match except PalmDB creation/modification timestamps, for AZW3 and MOBI. Metadata edits and no-ops match. |
| Large publication | A chapter exceeding the native 1 MiB threading threshold exports through the Wasm serial encoder; output matches native threaded compression. |
| Rejection and limits | Protected EPUB, traversal, external resource paths, malformed requests and all six conversion budgets reject with no result bytes. |
| Metadata-only Wasm | 3 Kindle fixtures, 11 native/Wasm edge cases and 8 explicit encoding rejections passed after rebuilding the asset. |
| Compiled Dart web adapter | 41 assertions passed using 22 real Node workers; all workers terminated. Includes export, metadata, capability loading, cancellation, timeout, busy state, snapshots, missing assets and same-origin checks. |
| Independent Foliate import | Both browser-generated Kindle files normalize with 2 chapters and 5 resources, retaining Unicode, metadata, nested TOC and cross-chapter links, with no warnings. |
| Provenance and notices | Vendored Kindling, metadata Wasm, full conversion Wasm, pinned runtime hashes and license inventory pass their verification scripts. |

Actual Chromium execution was attempted with the same compiled Dart probe. The
local environment denied Chromium's process-singleton `socket()` before it
opened a page. This is a blocked browser gate, not a passing browser assertion.
The package workflow retains the actual Chromium `--browser` gate, as well as
the independent Node/Wasm checks. Browser and device compatibility claims must
use completed hosted results; native compilation and Node worker tests alone
do not establish those claims.

## Reproduction and environment

Use Flutter 3.47.8 / Dart 3.13, Node 24.22.1, Rust 1.99.1, and the pinned Cargo
lockfiles. The package README contains the test/build commands. Wasm assets
are checked in, so an app build does not need a Wasm compiler.

In a restricted executor, configure `CI=true`, `BOT=true` and analytics
suppression before Flutter commands. A plain initial package-resolution attempt
was rejected when an optional SDK probe attempted a link-local metadata request;
offline resolution with those supported flags succeeded. Do not probe metadata
services or credentials. Set `TMPDIR` to an existing writable directory for
Node/Rust tests when the default temporary directory is unavailable. These are
local execution settings, not application behavior or tracked configuration.
