# Crisperbooks Kindle conversion

This package wraps the vendored Kindling 0.46.2 engine. It accepts immutable
input bytes and returns output bytes; only the application save session writes
the user's selected destination.

## Operations

| Operation | Output and limits |
| --- | --- |
| EPUB export | AZW3/KF8 or dual MOBI containing KF7 and KF8. This is conversion; typography, navigation, and unsupported features can change. |
| Kindle metadata update | Title, multiple authors, publisher, description, language, ISBN, ASIN, publication date, subjects, identifier, and replacement of an existing cover. Unchanged text/resource records are retained. |
| No-op metadata update | Returns byte-identical input. |
| MOBI/AZW3 import into EPUB | Provided by the separate `crisp_ebook_reader` Foliate adapter, not by this package. |

DRM-protected input is refused. EPUB font obfuscation using the IDPF or Adobe
algorithms is distinguished from DRM; Kindling can decode supported embedded
font resources. KFX is outside this package's supported formats.

New metadata text retains each MOBI section's declared encoding. UTF-8 and
Windows-1252 are supported; text that cannot be represented losslessly in the
declared encoding, or another encoding ID, produces an explicit error. The
converter never relabels the preserved book body as UTF-8. Title updates keep
EXTH, the header title, and its title hash consistent, including explicit clears.

The wrapper rejects unsafe archive paths, duplicate/case-colliding entries,
external resource paths, XML entity declarations, unsupported markup encodings,
and inputs exceeding its bounded archive/image budgets. Export runs upstream
Kindling validation, including the restored lightningcss grammar parser, then
reads back the produced Kindle container. A parsing or validation failure does
not overwrite the input. The original archive is never passed as an output path.

The default budgets are 64 MiB input, 128 MiB output, 192 MiB expanded content,
32 MiB per entry, 10,000 entries, and 50 million pixels per raster image. A
conversion makes a private temporary copy and checks that the copy is unchanged
before returning.

## Runtime and build

Native builds use a Dart code-assets build hook to compile and bundle the Rust
library. Install Rust 1.88 or newer and the target needed by the build. The
checked-in Cargo lockfile is always used with `--locked`.

Apple builds forward the complete minimum OS version supplied by Flutter,
including minor and patch components. The hook requires code_assets 2.2 or
newer so a deployment target such as macOS 10.15 is not truncated to 10.0.

| Platform | Build mapping |
| --- | --- |
| Linux | x64 and arm64; a cross linker/sysroot is required when not building for the host. |
| macOS | x64 and arm64, using the selected macOS SDK. |
| Windows | x64 and arm64 MSVC targets; the matching Visual Studio toolchain is required. |
| iOS | arm64 device, arm64 simulator, and x64 simulator, using the selected iOS SDK. |
| Android | arm64, armv7, and x64 through the NDK; shared-library alignment supports 16 KiB pages. |
| Browser | The bundled Wasm worker exports EPUB to AZW3/MOBI and edits existing Kindle metadata. Kindle cover replacement remains native-only. EPUB reading/editing and reader-side import are separate features. |

These target mappings describe the build configuration. They do not establish
that every target has passed a device runtime test. Check the feature's CI and
release smoke results before making a platform compatibility claim.

`.github/actions/setup-ebook-rust` installs Rust targets and the app's Android
NDK where needed. `ANDROID_NDK_HOME` or `ANDROID_NDK_ROOT` selects an explicit
NDK for local builds; otherwise the hook looks beneath the Android SDK.

An application may configure the hook in its own `pubspec.yaml`:

```yaml
hooks:
  user_defines:
    crisp_ebook_conversion:
      # Defaults to true. false deliberately omits the native converter.
      enabled: true
      # Optional instead of compiling; must match the actual build target:
      # kindling_library: /absolute/path/libcrisp_kindling_bridge.so
      # Optional toolchain locations:
      # cargo: /absolute/path/cargo
      # cargo_home: /absolute/path/cargo-home
      # rustup_home: /absolute/path/rustup-home
```

Dart runs hooks with a filtered environment. A nonstandard Rust installation
must use the user-defines above for its Cargo/Rustup homes; shell variables
`CARGO_HOME` and `RUSTUP_HOME` are not forwarded to hooks. Standard tool
discovery uses the permitted PATH and home-directory locations.

`KindlingConverter.capabilities()` reports whether the bundled runtime is
available and exposes separate flags for AZW3 export, MOBI export, metadata
rewriting and cover replacement. Native operations run on one worker thread and support cooperative
cancellation: the caller receives cancellation immediately, output is discarded,
and private files are retained until the worker has stopped using them. An
upstream synchronous build cannot be forcibly preempted. A separately built
desktop helper can be supplied through `executablePath` when process termination
is preferred. No helper is discovered or executed from arbitrary `PATH` entries.

### Browser conversion and metadata editing

The browser runs the same reviewed native request processor and Kindling builder
inside a dedicated module worker. It exports EPUB to AZW3/KF8 or dual MOBI and
sets or explicitly clears metadata in existing unencrypted AZW3, dual-MOBI and
legacy-MOBI files. Metadata edits retain their text and resource records. Results
are new byte arrays for the host's save/download flow.

The full engine targets `wasm32-wasip1`. Its only preopened directory is a fresh
memory-only `/job`; it has no access to host files, OPFS, sockets or external
conversion services. The pinned MIT-selected `@bjorn3/browser_wasi_shim` 0.4.2
implements those in-memory filesystem calls. Native archive, markup, image and
output validation is shared unchanged. WASI uses the existing sequential PalmDOC
encoder for large books because Preview 1 cannot create threads. Tests require
the same complete output bytes as native builds, apart from build timestamps.

The worker is loaded from Flutter package assets relative to `document.baseURI`.
A host may supply `webWorkerUri` for another bundled location on the same origin.
The compressed engine uses the browser's built-in `DecompressionStream`; both
compressed and decompressed downloads have explicit byte limits. A host that
already decodes the response is also supported. Capabilities load the module and
execute its version check before advertising AZW3, MOBI and metadata operations.
Missing assets or unsupported browser features report unavailable. Cover
replacement remains a separate native capability.

Each request owns a private snapshot and fresh worker. Cancellation or timeout
terminates the worker, discards partial output and releases its memory. The
browser enforces ceilings of 64 MiB input, 128 MiB output, 192 MiB expanded
archive data, 32 MiB per entry, 10,000 archive entries, 50 million pixels per
image, and 128 KiB request JSON. Wasm linear memory is limited to 512 MiB; the
separate JS memory filesystem is bounded before writes and resizes. Browser or
device resource constraints may still make a job fail. The host retains the
original input and receives a structured error.

The generated, deterministic gzip asset is checked in, so app builds need no
Wasm compiler. `CONVERSION_WASM.json` records compressed and expanded hashes,
worker/runtime hashes and build inputs. `WASI_SHIM.json` records the exact npm
release, source hashes and selected license. Rebuild from reviewed sources with:

```sh
rustup target add wasm32-wasip1
python3 tool/build_conversion_wasm.py
python3 tool/check_conversion_wasm.py
```

The separate metadata-only byte module remains as a smaller, independent
regression target. `WASM.json` records its asset and build inputs. Rebuild it with:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.121 --locked
python3 tool/build_metadata_wasm.py
python3 tool/check_wasm.py
```

This metadata-only module has no host imports. Both modules use the same
metadata byte implementation, reject encrypted primary or KF8 sections and
malformed PalmDB offsets, and avoid inflating unrelated embedded source ZIPs
for ordinary metadata changes.

## Reproduce verification

From this directory, with the application Dart SDK and Rust toolchain on PATH:

```sh
cargo test --manifest-path native/Cargo.toml --locked --lib
cargo build --manifest-path native/Cargo.toml --release --locked
python3 tool/check_vendor.py
python3 tool/check_licenses.py
python3 tool/smoke.py
dart pub get
dart analyze
dart test
```

The package's test configuration runs suites sequentially because Dart test
isolates share the native engine's one-job-per-process guard. Additional native
metadata tests cover every exposed field, explicit clearing, no-op/idempotence,
existing-cover replacement, pixel budgets and unchanged content records.

After the native smoke fixtures are generated, verify the actual Wasm engine
and production Dart browser adapter:

```sh
node tool/metadata_wasm_smoke.mjs
node tool/conversion_wasm_smoke.mjs
mkdir -p build/web-metadata
dart compile js tool/web_metadata_probe.dart -o build/web-metadata/probe.js
node tool/run_web_metadata_probe.mjs
```

The metadata gate independently checks PalmDB/EXTH records for all three Kindle
forms and requires byte-for-byte native/Wasm parity. The conversion gate compares
complete native/Wasm output, including large books that cross the native
threading threshold, and checks every archive/image/byte budget. The worker gate
executes the compiled Dart adapter in real Node workers with the actual bundled Wasm, testing
capability loading, both export formats, edits, worker termination, timeouts, concurrent requests,
source snapshots, missing assets, same-origin enforcement and size limits.
This worker/API test does not establish browser rendering compatibility. With
the reader package's Playwright dependencies and Chromium installed, append
`--browser` to also execute the same probe in an actual browser. `CHROMIUM_PATH`
can select an installed Chromium executable.

The native smoke suite independently inspects the PalmDB records, text,
Unicode content, metadata changes, no-op stability, source preservation,
DRM refusal, malformed EPUB confinement, and conversion budgets. It produces
original test MOBI/AZW3 fixtures under ignored `test/fixtures/generated/` for
the reader's independent import/reading smoke tests. These small fixtures
exercise the integration; they are not a representative compatibility corpus
for every publisher's ebooks.

Legacy MOBI verification also checks its TOC guide, nested labels, and exact
byte-offset navigation targets. The independent Foliate suite reads both the
modern KF8 and legacy KF7 streams and imports each into EPUB.

The cross-package import gate then checks the actual result with EPUBCheck
5.4.0. It retains metadata, Unicode, the nested TOC, cross-chapter links, and
every non-XHTML resource byte, reopens the emitted EPUB through the core, and
requires zero EPUBCheck errors or warnings for both the source fixture and all
three resulting EPUBs. It also verifies that all input file hashes remain
unchanged. Prepare the core's Dart dependencies and the reader's Node
dependencies, then run from this package:

```sh
(cd ../crisp_ebook && dart pub get)
(cd ../crisp_ebook_reader && npm ci --ignore-scripts --no-audit --no-fund)
python3 tool/verify_import_chain.py --epubcheck /path/to/epubcheck-5.4.0/epubcheck.jar
```

Reports and imported EPUBs are written to ignored `build/import-chain/`.
`--output` selects another directory. `--dart`, `--node`, and `--java` may
select explicit toolchains. In an environment without a writable default Java
temporary directory, supply `--java-temp-dir /writable/temporary/directory`
so EPUBCheck's ImageIO cache can validate PNG files correctly.

## Source and licenses

Kindling is MIT. Its exact upstream revision, selected files, and local patch
are in `UPSTREAM.md`, `UPSTREAM.json`, and `UPSTREAM.patch`. The CSS parser and
some of its dependencies use MPL-2.0, which is approved for this integration.
Those crates are unmodified; the shipped `licensing/THIRD_PARTY_LICENSES.txt`
contains their notices and links to the exact source releases. The complete
resolved Cargo dependency inventory includes native and metadata-Wasm builds,
with their platform and build dependencies, plus the selected WASI shim grant.
The shim is distributed with its original MIT license and unchanged ESM source;
its OPFS module is not bundled.

For a deliberate dependency change, review source/license changes before
running `python3 tool/check_licenses.py --record`. The checker rejects an
unreviewed grant or missing license evidence rather than silently dropping it.
