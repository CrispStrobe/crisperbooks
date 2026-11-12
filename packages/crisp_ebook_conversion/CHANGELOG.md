## Unreleased

- Export EPUB to AZW3 and dual MOBI in a bundled browser worker using the shared
  native validator and Kindling builder, with a bounded memory-only filesystem.
- Preserve worker cancellation, timeout, snapshot, same-origin and error recovery
  behavior; advertise export only after loading and probing the actual engine.
- Verify complete native/Wasm output parity, large-book compression, metadata,
  malformed inputs, all conversion budgets and the compiled Dart worker adapter.
- Pin the WASI runtime with original license notices and reproducible gzip Wasm
  provenance. Browser cover replacement remains unavailable.

# 0.1.0

Initial independent extraction from CrispCloud. Existing package names, source provenance, third-party notices and safety limits are retained. This version is not published to pub.dev.
