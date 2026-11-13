// WebKit can suppress parent-installed listeners in a script-disabled book
// frame (https://bugs.webkit.org/show_bug.cgi?id=218086). Observe the actual
// native selection from the trusted parent instead. Publication scripts stay
// disabled, and every locator still comes from the selected DOM Range.
const selectionText = (selection, range) => {
    const limit = 20000
    const root = range.commonAncestorContainer
    let budget = 4096, text = ''
    // The CFI describes range zero. Do not stringify a multi-range selection
    // that can include unrelated or arbitrarily large later ranges.
    const rendered = () => selection.rangeCount === 1
        ? selection.toString().slice(0, limit) : text
    const after = node => {
        while (node && node !== root) {
            if (--budget <= 0) return null
            if (node.nextSibling) return node.nextSibling
            node = node.parentNode
        }
        return null
    }
    const isText = node => node.nodeType === 3 || node.nodeType === 4
    let node = range.startContainer
    if (!isText(node)) node = node.childNodes[range.startOffset] ?? after(node)
    while (node && budget-- > 0) {
        if (range.comparePoint(node, 0) > 0) return rendered()
        if (isText(node)) {
            const start = node === range.startContainer ? range.startOffset : 0
            const end = node === range.endContainer ? range.endOffset : node.length
            const length = Math.min(end - start, limit - text.length)
            text += node.substringData(start, length)
            if (length < end - start || text.length >= limit) return text
            if (node === range.endContainer) return rendered()
        }
        node = node.firstChild ?? after(node)
    }
    // Keep native rendered whitespace for ordinary short selections. Large or
    // fragmented ranges use a bounded DOM-text prefix without first creating
    // an unbounded chapter string just to truncate it.
    return budget > 0 ? rendered() : text
}

export function createReaderSelection(view, {
    onSelection,
    schedule = setTimeout,
    cancel = clearTimeout,
    delay = 150,
    isCurrent = () => true,
} = {}) {
    let disposed = false, timer = null, previous = new Map()
    let indices = new WeakMap()
    const active = () => !disposed && isCurrent()
    const validIndex = index => Number.isSafeInteger(index) && index >= 0
    const loaded = ({detail}) => {
        if (!active()) return
        const {doc, index} = detail ?? {}
        if (!doc || !validIndex(index)) return
        // Fixed-layout getContents() omits index. The trusted renderer load
        // event binds each actual document to its publication section.
        indices.set(doc, index)
        previous.delete(doc)
    }
    view.addEventListener?.('load', loaded)
    const scan = () => {
        timer = null
        if (!active()) return
        const current = new Map()
        let contents = []
        try { contents = (view.renderer?.getContents?.() ?? []).slice(0, 8) }
        catch { /* A reflow can temporarily detach the renderer. */ }
        // Paginators normally expose one document and fixed layouts at most a
        // spread. Bound the work even if a future renderer exposes more.
        for (const {doc, index:contentIndex} of contents) {
            if (!active()) break
            const index = indices.get(doc) ?? contentIndex
            if (!validIndex(index)) continue
            try {
                const selection = doc.getSelection()
                if (!selection?.rangeCount || selection.isCollapsed) continue
                const range = selection.getRangeAt(0)
                const value = {index, start:range.startContainer, from:range.startOffset,
                    end:range.endContainer, to:range.endOffset}
                const old = previous.get(doc)
                if (old && Object.keys(value).every(key => value[key] === old[key])) {
                    current.set(doc, value)
                    continue
                }
                const text = selectionText(selection, range)
                const cfi = view.getCFI(index, range)
                if (!active()) break
                if (typeof cfi !== 'string' || !cfi.startsWith('epubcfi(')) continue
                current.set(doc, value)
                onSelection({text, cfi, sectionIndex:index})
            } catch {
                // A navigation may detach a document between enumeration and
                // reading its range. Never retain or report that stale range.
                current.delete(doc)
            }
        }
        // Delivery can synchronously dispose or replace the reader. Do not
        // retain the just-delivered document after disposal cleared our state.
        previous = active() ? current : new Map()
        if (active()) timer = schedule(scan, delay)
    }
    timer = schedule(scan, delay)
    return {
        dispose() {
            if (disposed) return
            disposed = true
            cancel(timer)
            timer = null
            view.removeEventListener?.('load', loaded)
            view = null
            indices = new WeakMap()
            previous.clear()
            onSelection = null
            isCurrent = null
        },
    }
}
