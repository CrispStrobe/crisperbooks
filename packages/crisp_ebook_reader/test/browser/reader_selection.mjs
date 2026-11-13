import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {createReaderSelection} from '../../assets/reader_selection.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const publication = (text = 'A library stays local.') => {
    const doc = dom.window.document.implementation.createHTMLDocument('Selection fixture')
    const paragraph = doc.createElement('p')
    paragraph.textContent = text
    doc.body.append(paragraph)
    const range = doc.createRange()
    range.selectNodeContents(paragraph)
    const state = {reads:0, strings:0, range, fail:false}
    state.selection = {
        rangeCount:1, isCollapsed:false,
        getRangeAt:index => { assert.equal(index, 0); return state.range },
        toString:() => { ++state.strings; return state.range.toString() },
    }
    doc.getSelection = () => {
        ++state.reads
        if (state.fail) throw new Error('Detached document')
        return state.selection
    }
    return {doc, paragraph, state}
}

const harness = (onSelection = null) => {
    let nextId = 0
    const scheduled = new Map(), reports = [], conversions = []
    const state = {contents:[], live:true, failContents:false, failCFI:false, invalidCFI:false}
    const schedule = (callback, delay) => {
        assert.equal(delay, 150)
        const id = ++nextId
        scheduled.set(id, callback)
        return id
    }
    const cancel = id => scheduled.delete(id)
    const tick = () => {
        assert.equal(scheduled.size, 1, 'The observer owns exactly one polling timer')
        const [id, callback] = scheduled.entries().next().value
        scheduled.delete(id)
        callback()
    }
    const view = new EventTarget()
    view.renderer = {getContents:() => {
        if (state.failContents) throw new Error('Reflow detached the renderer')
        return state.contents
    }}
    view.getCFI = (index, range) => {
        if (state.failCFI) throw new Error('Range disappeared during reflow')
        if (state.invalidCFI) return undefined
        conversions.push({index, range})
        return `epubcfi(/6/${(index + 1) * 2}!/4/2:${range.startOffset})`
    }
    const observer = createReaderSelection(view, {
        onSelection:value => { reports.push(value); onSelection?.(value) },
        schedule, cancel, isCurrent:() => state.live,
    })
    const load = (doc, index) => view.dispatchEvent(new CustomEvent('load', {detail:{doc, index}}))
    return {state, reports, conversions, scheduled, tick, observer, view, load}
}

export function checkReaderSelection() {
    let cases = 0
    const test = (name, run) => { run(); ++cases; console.log(`PASS ${name}`) }

    test('native ranges are observed without publication callbacks and stable endpoints are deduplicated', () => {
        const h = harness(), first = publication()
        h.state.contents = [{doc:first.doc, index:2}]
        h.tick()
        assert.deepEqual(h.reports, [{text:'A library stays local.', cfi:'epubcfi(/6/6!/4/2:0)', sectionIndex:2}])
        assert.equal(h.conversions[0].range, first.state.range)
        h.tick()
        assert.equal(h.reports.length, 1)
        assert.equal(first.state.strings, 1, 'A stable range does not extract its text again')
        assert.equal(h.conversions.length, 1, 'A stable range does not repeat CFI conversion')
        first.state.range.setStart(first.paragraph.firstChild, 2)
        h.tick()
        assert.equal(h.reports.at(-1).text, 'library stays local.')
        for (const property of ['isCollapsed', 'rangeCount']) {
            first.state.selection[property] = property === 'isCollapsed' ? true : 0
            h.tick()
            first.state.selection[property] = property === 'isCollapsed' ? false : 1
            h.tick()
        }
        assert.equal(h.reports.length, 4, 'Reselecting the same range after clearing is a new selection')
        h.observer.dispose()
    })

    test('trusted load events identify fixed-layout documents and unknown pages are not guessed', () => {
        const h = harness(), fixed = publication('The right page.'), unknown = publication('Unknown page.')
        h.load(fixed.doc, 7)
        h.state.contents = [{doc:unknown.doc}, {doc:fixed.doc}]
        h.tick()
        assert.deepEqual(h.reports, [{text:'The right page.', cfi:'epubcfi(/6/16!/4/2:0)', sectionIndex:7}])
        assert.equal(unknown.state.reads, 0)
        h.state.contents = [{doc:fixed.doc, index:0}]
        h.tick()
        assert.equal(h.reports.length, 1, 'A stale content index does not override the trusted document mapping')
        h.load(fixed.doc, 8)
        h.tick()
        assert.equal(h.reports.at(-1).sectionIndex, 8)
        h.state.contents = []
        const reads = fixed.state.reads
        h.tick()
        assert.equal(fixed.state.reads, reads, 'Unloaded pages are not observed')
        h.observer.dispose()
    })

    test('large single-node selections use bounded substrings without materializing full text', () => {
        const h = harness(), large = publication('x'.repeat(100000))
        Object.defineProperty(large.paragraph.firstChild, 'data', {get() { throw new Error('Unbounded text read') }})
        large.state.selection.toString = () => { throw new Error('Unbounded selection read') }
        h.state.contents = [{doc:large.doc, index:0}]
        h.tick()
        assert.equal(h.reports.length, 1)
        assert.equal(h.reports[0].text, 'x'.repeat(20000))
        h.observer.dispose()
    })

    test('fragmented selections stop at a bounded node traversal budget', () => {
        const h = harness(), fragmented = publication('')
        for (let i = 0; i < 5000; ++i) {
            const span = fragmented.doc.createElement('span')
            span.textContent = 'a'
            fragmented.paragraph.append(span)
        }
        fragmented.state.range.selectNodeContents(fragmented.paragraph)
        fragmented.state.selection.toString = () => { throw new Error('Unbounded fragmented selection') }
        h.state.contents = [{doc:fragmented.doc, index:1}]
        h.tick()
        assert.equal(h.reports.length, 1)
        assert(h.reports[0].text.length > 0 && h.reports[0].text.length < 4096)
        h.observer.dispose()
    })

    test('multi-range text belongs only to the first range represented by the CFI', () => {
        const h = harness(), multiple = publication('Only the first range.')
        multiple.state.selection.rangeCount = 2
        multiple.state.selection.toString = () => { throw new Error('Later ranges must not be read') }
        h.state.contents = [{doc:multiple.doc, index:3}]
        h.tick()
        assert.deepEqual(h.reports, [{text:'Only the first range.', cfi:'epubcfi(/6/8!/4/2:0)', sectionIndex:3}])
        assert.equal(h.conversions[0].range, multiple.state.range)
        h.observer.dispose()
    })

    test('short selections preserve native rendered whitespace', () => {
        const h = harness(), first = publication('Rendered whitespace')
        first.state.selection.toString = () => 'Rendered\nwhitespace'
        h.state.contents = [{doc:first.doc, index:0}]
        h.tick()
        assert.equal(h.reports[0].text, 'Rendered\nwhitespace')
        h.observer.dispose()
    })

    test('partial ranges obey their text and element boundaries', () => {
        const h = harness(), first = publication('')
        first.paragraph.innerHTML = '<span>before</span><b>first</b><i>second</i><span>after</span>'
        first.state.range.setStart(first.paragraph.querySelector('b').firstChild, 2)
        first.state.range.setEnd(first.paragraph, 3)
        first.state.selection.rangeCount = 2
        first.state.selection.toString = () => { throw new Error('Later ranges must not be read') }
        h.state.contents = [{doc:first.doc, index:0}]
        h.tick()
        assert.equal(h.reports[0].text, 'rstsecond')
        h.observer.dispose()
    })

    test('reflow, detached documents, and invalid CFIs do not stop polling or suppress later recovery', () => {
        const h = harness(), first = publication()
        h.state.contents = [{doc:first.doc, index:0}]
        h.state.failContents = true
        h.tick()
        h.state.failContents = false
        first.state.fail = true
        h.tick()
        first.state.fail = false
        h.state.failCFI = true
        h.tick()
        h.state.failCFI = false
        h.state.invalidCFI = true
        h.tick()
        assert.equal(h.reports.length, 0)
        h.state.invalidCFI = false
        h.tick()
        assert.equal(h.reports.length, 1)
        h.observer.dispose()
    })

    test('invalid section identities are rejected and each scan observes at most eight documents', () => {
        const h = harness(), first = publication()
        for (const index of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0']) {
            h.load(first.doc, index)
            h.state.contents = [{doc:first.doc, index}]
            h.tick()
        }
        assert.equal(first.state.reads, 0)
        const pages = Array.from({length:9}, () => publication())
        h.state.contents = pages.map(({doc}, index) => ({doc, index}))
        h.tick()
        assert.equal(h.reports.length, 8)
        assert.equal(pages[8].state.reads, 0)
        h.observer.dispose()
    })

    test('replaced readers and disposed callbacks cannot read or schedule more work', () => {
        const h = harness(), first = publication()
        h.state.contents = [{doc:first.doc, index:0}]
        h.state.live = false
        h.tick()
        assert.equal(first.state.reads, 0)
        assert.equal(h.scheduled.size, 0)
        h.observer.dispose()
        h.observer.dispose()
        const closing = harness()
        const late = closing.scheduled.values().next().value
        closing.observer.dispose()
        closing.view.renderer.getContents = () => { throw new Error('Closed renderer was touched') }
        closing.load(first.doc, 0)
        assert.doesNotThrow(late)
        assert.equal(closing.scheduled.size, 0)
        assert.equal(closing.reports.length, 0)
    })

    test('disposal during selection delivery releases the current timer', () => {
        const h = harness(() => h.observer.dispose()), first = publication()
        h.state.contents = [{doc:first.doc, index:0}]
        h.tick()
        assert.equal(h.reports.length, 1)
        assert.equal(h.scheduled.size, 0)
    })
    console.log(`PASS ${cases} real-DOM selection recovery cases`)
}

checkReaderSelection()
