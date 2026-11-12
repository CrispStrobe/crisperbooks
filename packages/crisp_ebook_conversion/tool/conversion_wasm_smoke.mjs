// Exercise the actual Wasm converter and compare native book bytes. The only
// allowed difference is PalmDB creation/modification time (seconds at build).
import assert from 'node:assert/strict'
import {readFile, writeFile, mkdtemp, rm, mkdir} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync} from 'node:zlib'
import {instantiateConversionEngine} from '../assets/conversion_runtime.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const binary = process.argv[2] || path.join(root, 'native/target/release',
    process.platform === 'win32' ? 'crisp-kindling.exe' : 'crisp-kindling')
const engine = await instantiateConversionEngine(gunzipSync(
    await readFile(path.join(root, 'assets/kindling_conversion.wasm.gz'))))
const limits = {input_bytes: 67108864, output_bytes: 134217728,
    expanded_bytes: 201326592, entry_bytes: 33554432, entries: 10000, image_pixels: 50000000}
const request = (format = 'azw3', extra = {}) => ({operation: 'export', format,
    metadata: {}, limits, ...extra})

async function native(input, req) {
    const folder = await mkdtemp(path.join(tmpdir(), 'crisp-conversion-parity-'))
    try {
        const filename = path.join(folder, req.operation === 'metadata' ? 'input.mobi' : 'input.epub')
        await writeFile(filename, input)
        const run = spawnSync(binary, [], {encoding: 'utf8', timeout: 60000,
            input: JSON.stringify({...req, work_dir: folder, cover: false})})
        assert.equal(run.status, 0, String(run.error || run.stderr))
        const result = JSON.parse(run.stdout.trim().split('\n').filter(line => line.startsWith('{')).at(-1))
        assert.deepEqual(await readFile(filename), Buffer.from(input), 'Native input snapshot is unchanged')
        if (result.ok) result.bytes = await readFile(path.join(folder, `output.${req.format}`))
        return result
    } finally { await rm(folder, {recursive: true, force: true}) }
}

function untimed(bytes) {
    const copy = Buffer.from(bytes)
    assert.equal(copy.subarray(60, 68).toString(), 'BOOKMOBI')
    copy.fill(0, 36, 44)
    return copy
}

async function parity(input, req) {
    const baseline = Buffer.from(input)
    const result = await engine.convert(input, JSON.stringify(req))
    assert.equal(result.ok, true, JSON.stringify(result))
    const reference = await native(input, req)
    assert.equal(reference.ok, true, JSON.stringify(reference))
    assert.deepEqual(untimed(result.bytes), untimed(reference.bytes),
        `${req.format}: text, resources, metadata, TOC, offsets and sections must match native`)
    assert.deepEqual(result.changes, reference.changes)
    assert.deepEqual(result.warnings, reference.warnings)
    assert.deepEqual(input, baseline, 'Wasm input snapshot is unchanged')
    return result
}

const input = await readFile(path.join(root, 'test/fixtures/book.epub'))
await mkdir(path.join(root, 'test/fixtures/generated'), {recursive: true})
for (const format of ['azw3', 'mobi']) {
    const exported = await parity(input, request(format))
    await writeFile(path.join(root, `test/fixtures/generated/web-book.${format}`), exported.bytes)
    const patch = {title: 'Browser café 世界', authors: ['One', 'Zwei']}
    const edited = await parity(Buffer.from(exported.bytes),
        request(format, {operation: 'metadata', metadata: patch}))
    assert.ok(edited.changes.length > 0)
    const noop = await parity(Buffer.from(edited.bytes), request(format, {operation: 'metadata', metadata: patch}))
    assert.equal(noop.noOp, true)
    assert.deepEqual(noop.bytes, edited.bytes)
    console.log(`PASS ${format}: native/Wasm complete bytes (except build time), metadata edit and byte-identical no-op`)
}

for (const [name, code] of [['traversal', 'invalidInput'], ['external_resource', 'invalidInput'],
    ['protected', 'drmProtected']]) {
    const bytes = await readFile(path.join(root, `test/fixtures/${name}.epub`))
    const result = await engine.convert(bytes, JSON.stringify(request()))
    assert.equal(result.code, code, JSON.stringify(result))
    assert.equal(result.bytes, undefined)
    assert.equal((await native(bytes, request())).code, code)
}
for (const key of ['input_bytes', 'output_bytes', 'expanded_bytes', 'entry_bytes', 'entries', 'image_pixels']) {
    const result = await engine.convert(input, JSON.stringify(request('azw3', {limits: {...limits, [key]: 1}})))
    assert.equal(result.code, 'limitExceeded', `${key}: ${JSON.stringify(result)}`)
    assert.equal(result.bytes, undefined)
}
assert.equal((await engine.convert(input, '{')).code, 'invalidInput')
assert.equal((await engine.convert(input, JSON.stringify(request('kfx')))).code, 'unsupportedFormat')
assert.equal((await engine.convert(input, JSON.stringify(request('azw3', {cover: true})))).code, 'unsupportedOperation')
console.log('PASS malformed input, DRM, traversal, external resources and all six byte/archive/image budgets')

// Exceed Kindling's 1 MiB native threading threshold. Preview 1 must take the
// byte-equivalent serial encoder rather than trying to create native threads.
const large = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import io, sys, zipfile
out=io.BytesIO()
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(out, 'w') as target:
    for item in source.infolist():
        data=source.read(item.filename)
        if item.filename.endswith('chapter1.xhtml'):
            data=data.replace(b'</body>', (b'<p>Large browser chapter caf&#233; and links.</p>'*30000)+b'</body>')
        target.writestr(item, data)
sys.stdout.buffer.write(out.getvalue())
`, path.join(root, 'test/fixtures/book.epub')], {maxBuffer: 8 * 1024 * 1024})
assert.equal(large.status, 0, String(large.stderr))
// Guard against accidentally losing the test expansion when fixtures change.
assert.ok(large.stdout.length > input.length)
for (const format of ['azw3', 'mobi']) await parity(large.stdout, request(format))
console.log('PASS large-book serial Wasm compression matches native threaded output')
