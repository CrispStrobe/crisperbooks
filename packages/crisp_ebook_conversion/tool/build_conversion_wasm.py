"""Build the shared bounded Kindle converter for a memory-only WASI worker."""
import argparse
import gzip
import json
import os
from pathlib import Path
import subprocess

from check_conversion_wasm import manifest

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cargo', default='cargo')
    parser.add_argument('--rustc', default='rustc')
    args = parser.parse_args()
    env = os.environ.copy()
    env['RUSTFLAGS'] = '-C opt-level=z -C strip=symbols -C link-arg=--max-memory=536870912 -C link-arg=-zstack-size=1048576'
    subprocess.run([args.cargo, 'build', '--manifest-path', 'native/Cargo.toml',
                    '--bin', 'crisp-kindling', '--target', 'wasm32-wasip1',
                    '--release', '--locked'], cwd=ROOT, env=env, check=True)
    source = ROOT / 'native/target/wasm32-wasip1/release/crisp-kindling.wasm'
    target = ROOT / 'assets/kindling_conversion.wasm.gz'
    # Zero mtime keeps identical compiler output byte-identical when rebuilt.
    target.write_bytes(gzip.compress(source.read_bytes(), compresslevel=9, mtime=0))
    target.chmod(0o644)
    rustc = subprocess.check_output([args.rustc, '--version'], text=True).strip()
    (ROOT / 'CONVERSION_WASM.json').write_text(json.dumps(manifest(rustc), indent=2) + '\n')
    print(f'Built {target.relative_to(ROOT)} ({target.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
