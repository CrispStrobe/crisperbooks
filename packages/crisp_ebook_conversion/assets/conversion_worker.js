import {instantiateConversionEngine} from './conversion_runtime.js'

let loading
const engine = () => loading ??= (async () => {
    const response = await fetch(new URL('./kindling_conversion.wasm.gz', import.meta.url))
    if (!response.ok) throw new Error('The bundled Kindle converter could not be loaded.')
    const packed = await boundedBytes(response.body, 16 * 1024 * 1024)
    let bytes = packed
    if (packed[0] === 0x1f && packed[1] === 0x8b) {
        if (typeof DecompressionStream !== 'function')
            throw new Error('This browser cannot load the compressed Kindle converter.')
        bytes = await boundedBytes(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),
            16 * 1024 * 1024)
    }
    if (bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d)
        throw new Error('Invalid bundled Kindle converter.')
    return instantiateConversionEngine(bytes)
})()
let busy = false

async function boundedBytes(stream, limit) {
    if (!stream) throw new Error('Missing Kindle converter data.')
    const reader = stream.getReader()
    const chunks = []
    let length = 0
    try {
        while (true) {
            const {value, done} = await reader.read()
            if (done) break
            length += value.length
            if (length > limit) throw new Error('Bundled Kindle converter exceeds the size limit.')
            chunks.push(value)
        }
    } finally { await reader.cancel() }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
}

self.onmessage = async ({data}) => {
    if (!data || !['probe', 'convert'].includes(data.kind)) return
    if (busy) {
        self.postMessage({kind: 'result', json: JSON.stringify({ok: false,
            code: 'busy', message: 'A conversion operation is still running.'})})
        return
    }
    busy = true
    try {
        const runtime = await engine()
        if (data.kind === 'probe') {
            self.postMessage({kind: 'ready', json: JSON.stringify({abi: runtime.abi, version: runtime.version})})
        } else {
            const result = await runtime.convert(new Uint8Array(data.bytes), data.request)
            const bytes = result.bytes?.buffer
            delete result.bytes
            self.postMessage({kind: 'result', json: JSON.stringify(result), bytes}, bytes ? [bytes] : [])
        }
    } catch (error) {
        self.postMessage({kind: 'result', json: JSON.stringify({ok: false,
            code: data.kind === 'probe' ? 'unavailable' : 'conversionFailed',
            message: error instanceof Error ? error.message : 'Kindle conversion failed.'})})
    } finally {
        busy = false
    }
}
