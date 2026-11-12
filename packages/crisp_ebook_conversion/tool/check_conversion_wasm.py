"""Verify the bundled full Kindle Wasm, memory-only runtime and build inputs."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ['assets/kindling_conversion.wasm.gz', 'assets/conversion_runtime.js',
          'assets/conversion_worker.js']
SOURCES = ['native/Cargo.toml', 'native/Cargo.lock', 'native/src/lib.rs',
           'native/src/main.rs', 'UPSTREAM.json', 'WASI_SHIM.json',
           'tool/build_conversion_wasm.py', 'tool/check_conversion_wasm.py']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(rustc):
    shim = json.loads((ROOT / 'WASI_SHIM.json').read_text())
    for name, expected in shim['files'].items():
        if digest(ROOT / name) != expected:
            raise ValueError(f'Unreviewed WASI shim file: {name}')
    with gzip.open(ROOT / ASSETS[0], 'rb') as source:
        wasm = source.read(16 * 1024 * 1024 + 1)
    if len(wasm) > 16 * 1024 * 1024 or not wasm.startswith(b'\0asm\x01\0\0\0'):
        raise ValueError('Invalid or oversized conversion Wasm')
    return {
        'schema': 1,
        'engine': 'Kindling 0.46.2 shared native request processor',
        'abi': 2,
        'rustc': rustc,
        'target': 'wasm32-wasip1',
        'max_memory_bytes': 536870912,
        'wasm_bytes': len(wasm),
        'wasm_sha256': hashlib.sha256(wasm).hexdigest(),
        'scope': 'EPUB export and Kindle metadata; fresh memory-only /job per operation; no host files, sockets or OPFS.',
        'asset_sha256': {name: digest(ROOT / name) for name in ASSETS},
        'source_sha256': {name: digest(ROOT / name) for name in SOURCES},
    }


if __name__ == '__main__':
    expected = json.loads((ROOT / 'CONVERSION_WASM.json').read_text())
    if manifest(expected['rustc']) != expected:
        raise SystemExit('Conversion Wasm or reviewed inputs changed; rebuild and review the asset.')
    print('Verified bundled conversion Wasm, runtime, WASI shim and source hashes (ABI 2).')
