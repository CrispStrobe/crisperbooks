# Reader selection recovery — 13 November 2026

This continuation carries the remaining selection safeguards from CrispCloud
candidate `464e4dd3f548302ee5b9f78994fa09caf95437bc` into the canonical extracted
reader. Its source remains in CrispCloud's saved history; the consuming app must
not restore the old bundled `packages/crisp_ebook_reader` tree.

The starting canonical revision is
`34fcda23129ca194bcf598fed57983a5593fcb34`. Its observer already polls actual
native selections from the trusted host while publication scripts stay disabled.
The migration retains that observer API, its timer scheduling, native input
adapter, speech integration, and later platform qualification work.

## Recovered behavior

- Read at most 20,000 text code units and traverse at most 4,096 nodes/ancestor
  steps before returning a bounded prefix. A large selection no longer creates
  a complete chapter string merely to truncate it.
- Bind a multi-range quote to range zero, the same range represented by its CFI.
  Short single ranges retain native rendered whitespace.
- Record section indices from the renderer's trusted `load` events. Fixed-layout
  `getContents()` entries omit indices, so the observer starts before `init`
  emits the first document loads. Unknown sections are not guessed.
- Keep native selection polling independent of publication callbacks, deduplicate
  unchanged range endpoints, retry after transient renderer/CFI failures, and
  release timers/listeners on replacement, failed initialization, or disposal.

## Verification

`node packages/crisp_ebook_reader/test/browser/reader_selection.mjs` passes
**11 cases** using real JSDOM Range/Text nodes with controlled selection and
timer adapters. The cases cover missing child callbacks, dragging/reselection,
exact fixed-layout mapping, large and fragmented text, multiple ranges, element
boundaries, malformed section identities, an eight-document scan bound,
reflow recovery, and reader replacement/disposal.

These deterministic DOM checks do not establish a new native WebKit, Chromium,
or device acceptance result. Existing hosted reader workflows run this file;
the actual-browser suite remains a separate qualification gate.

The normal and forced grouping/raw-inflate compatibility parser suites pass,
including the new two-page fixed-layout text fixture. The native input-adapter
checks also pass. The hosted step installs its existing pinned npm dependencies
before running the real-DOM selection checks.

The browser suite now selects real text through the host bridge in an ordinary
EPUB and on both fixed-layout pages, checking exact text, CFI and section index.
Local Chromium execution was attempted but stopped before opening a page because
the managed environment rejects Chromium's process-singleton socket
(`socket() failed: Operation not permitted`). No browser assertion ran locally;
the new assertions are committed for the separate hosted browser gate.
