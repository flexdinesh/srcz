import { MessageSquarePlusIcon } from "lucide-react"
import { Fragment, memo, useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react"

import { ChangeMark } from "../../components/ui/change-mark.tsx"
import { CopyButton } from "../../components/ui/copy-button.tsx"
import { IconButton } from "../../components/ui/icon-button.tsx"
import type { ColumnRange, NavigationKind } from "../navigation/code-navigation.ts"
import { clampLineRange, lineReference, spanLines, splitSourceLines, startLineSelection, type LineRange } from "../../lib/line-selection.ts"
import { showLink, targetAt, wordRange, type SourceTarget } from "../navigation/source-position.ts"
import { useHighlightedLines } from "../../highlighting/use-highlighted-lines.ts"
import { markerLabel, markerRows, type ChangeMarker } from "../source-control/change-markers.ts"

// LineSelection connects gutter selection to its owner (the URL fragment).
export interface LineSelection {
  path: string
  range: LineRange | null
  onChange(range: LineRange | null): void
}

// SourceNavigation connects names in code to go to definition and find
// references. A plain click remembers the name for F12 and the command
// palette; Ctrl/Cmd+click goes to its definition.
export interface SourceNavigation {
  onPoint(target: SourceTarget): void
  // onNavigate runs from target, or from the remembered name when null.
  onNavigate(kind: NavigationKind, target: SourceTarget | null): void
}

// SourceAnnotation is a full-width zone inserted after a line, or before the
// first when line is 0, e.g. a walkthrough step's narration. render reads the
// source's lines by number; views without them pass null and show the zone
// at their top. focus dims the lines outside it (decision 0113).
export interface SourceAnnotation {
  line: number
  focus?: LineRange | null
  render(lineAt: ((line: number) => string | undefined) | null): ReactNode
}

// SourceZone is a full-width zone after line, or before the first when line
// is 0 or past the last, e.g. a feedback thread (decision 0120).
export interface SourceZone {
  key: string
  line: number
  node: ReactNode
}

// SourceComments places feedback zones and starts a comment on the selected
// lines: the gutter's Comment button, or C outside text fields.
export interface SourceComments {
  zones: readonly SourceZone[]
  onComment(range: LineRange): void
}

// SourceChanges marks where the file differs from HEAD in the gutter
// (decision 0115); onOpen opens a marker's change in its review.
export interface SourceChanges {
  markers: readonly ChangeMarker[]
  onOpen(marker: ChangeMarker): void
}

// SourceBlame shows who last changed the active line, after its text
// (decision 0139). onActiveLine reports the active line: a clicked row, a
// pressed line number, or a loaded line anchor's first line. render draws the
// active line's blame, null for none.
export interface SourceBlame {
  onActiveLine(line: number): void
  render(line: number): ReactNode
}

// LineDrag previews a gutter selection until pointer release commits it.
interface LineDrag {
  anchor: number
  range: LineRange
  active: boolean
}

function rangeKey(range: LineRange | null): string {
  return range ? `${range.start}-${range.end}` : ""
}

interface SourceDocumentProps {
  source: string
  // language is the server's Highlights language; null shows plain text.
  language: string | null
  label: string
  selection?: LineSelection
  navigation?: SourceNavigation
  annotation?: SourceAnnotation
  changes?: SourceChanges
  comments?: SourceComments
  blame?: SourceBlame
}

// LineCopyButton copies a line reference from the gutter. Its presses stay
// out of the gutter, which selects lines.
export function LineCopyButton({ reference }: { reference: string }) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation()
  return (
    <span className="source-line-copy" onPointerDown={stop} onMouseDown={stop} onClick={stop}>
      <CopyButton text={reference} label={`Copy ${reference}`} variant="gutter" className="source-line-copy-button" />
    </span>
  )
}

// LineCommentButton starts a comment on the selected lines from the gutter,
// beside Copy. Its presses stay out of the gutter, which selects lines.
function LineCommentButton({ onComment }: { onComment(): void }) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation()
  return (
    <span className="source-line-comment" onPointerDown={stop} onMouseDown={stop}>
      <IconButton size="xs" variant="gutter" label="Comment on Lines" title="Comment on lines (C)" aria-keyshortcuts="c"
        icon={<MessageSquarePlusIcon aria-hidden="true" />}
        onClick={(event) => {
          event.stopPropagation()
          onComment()
        }} />
    </span>
  )
}

// LineBlame holds the active line's blame after its text, outside native
// text selection and copies. Its presses stay out of the row and the code,
// which would set the active line and point at a name.
function LineBlame({ children }: { children: ReactNode }) {
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation()
  return <span className="source-line-blame" onPointerDown={stop} onMouseDown={stop} onClick={stop}>{children}</span>
}

// isTextField reports a target that takes typed text, whose keys are its own.
function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

// zoneLine is the line a zone follows: 0, the top, when it is past the last.
function zoneLine(line: number, count: number): number {
  return line <= count ? line : 0
}

function modified(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey
}

// Keep text nodes stable during hover and selection updates. Reassigning
// highlighted HTML clears the browser's native text selection.
const SourceLineContent = memo(function SourceLineContent({ line, highlighted }: { line: string; highlighted: string | undefined }) {
  return highlighted !== undefined
    ? <span className="source-document-line-content" dangerouslySetInnerHTML={{ __html: highlighted }} />
    : <span className="source-document-line-content">{line}</span>
})

export function SourceDocument({ source, language, label, selection, navigation, annotation, changes, comments, blame }: SourceDocumentProps) {
  const lines = splitSourceLines(source)
  // Rows show plain text until highlighting arrives.
  const highlightedLines = useHighlightedLines(source, language)
  const selectionAnchor = useRef<number | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const gutterWidth = `calc(${String(lines.length).length}ch + 36px)`
  const range = clampLineRange(selection?.range ?? null, lines.length)
  const [drag, setDrag] = useState<LineDrag | null>(null)
  // The active line is the last row clicked or line number pressed, or a
  // loaded anchor's first line; ownRange is the selection this gutter last
  // made, whose anchor keeps the pressed line active.
  const [activeLine, setActiveLine] = useState<number | null>(range?.start ?? null)
  const [ownRange, setOwnRange] = useState("")
  // A committed drag shows until the URL catches up, then the URL rules again.
  const [seenRange, setSeenRange] = useState(rangeKey(range))
  if (seenRange !== rangeKey(range)) {
    setSeenRange(rangeKey(range))
    if (drag && !drag.active) setDrag(null)
    if (range && rangeKey(range) !== ownRange) setActiveLine(range.start)
  }
  const shown = drag?.range ?? range
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const markers = changes?.markers
  const marks = useMemo(() => markerRows(markers ?? [], lines.length), [lines.length, markers])
  const [linked, setLinked] = useState<{ line: number; word: ColumnRange } | null>(null)

  // link marks the name under the pointer while Ctrl/Cmd is held.
  const link = useCallback((active: boolean) => {
    const root = container.current
    const target = active && root && pointer.current ? targetAt(root, pointer.current.x, pointer.current.y) : null
    const word = target?.word ?? null
    setLinked((current) => {
      if (!target || !word) return null
      return current?.line === target.position.line && current.word.start === word.start ? current : { line: target.position.line, word }
    })
  }, [])

  // Rendering may replace the highlighted text nodes, so the underline's
  // range is rebuilt from the DOM after every render.
  useLayoutEffect(() => {
    const root = container.current
    showLink(root && linked ? wordRange(root, linked.line, linked.word) : null)
  })

  useEffect(() => {
    if (!navigation) return
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Meta" || event.key === "Control") link(event.type === "keydown")
    }
    const clear = () => link(false)
    window.addEventListener("keydown", key)
    window.addEventListener("keyup", key)
    window.addEventListener("blur", clear)
    return () => {
      window.removeEventListener("keydown", key)
      window.removeEventListener("keyup", key)
      window.removeEventListener("blur", clear)
      showLink(null)
    }
  }, [link, navigation])

  useEffect(() => {
    if (!drag?.active || !selection) return
    const finish = () => {
      if (rangeKey(drag.range) === rangeKey(range)) {
        setDrag(null)
        return
      }
      setDrag({ ...drag, active: false })
      setOwnRange(rangeKey(drag.range))
      selection.onChange(drag.range)
    }
    const cancel = () => setDrag(null)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
    return () => {
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
    }
  }, [drag, range, selection])

  // C comments on the selection while focus is in the document or nowhere.
  const comment = comments?.onComment
  useEffect(() => {
    if (!comment || !range) return
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "c" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTextField(event.target)) return
      const root = container.current
      if (event.target !== document.body && !(event.target instanceof Node && root?.contains(event.target))) return
      event.preventDefault()
      comment(range)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [comment, range])

  // The active line's blame loads once a line is active.
  const reportActive = blame?.onActiveLine
  useEffect(() => {
    if (activeLine !== null) reportActive?.(activeLine)
  }, [activeLine, reportActive])

  function pressGutter(event: PointerEvent, lineNumber: number) {
    if (!selection || event.button !== 0) return
    container.current?.focus({ preventScroll: true })
    setActiveLine(lineNumber)
    const next = startLineSelection(range, selectionAnchor.current, lineNumber, event.shiftKey)
    selectionAnchor.current = next.anchor
    // Touch keeps scrolling the page; it selects on tap without dragging.
    if (event.pointerType === "touch") {
      setOwnRange(rangeKey(next.range))
      selection.onChange(next.range)
    } else setDrag({ ...next, active: true })
  }

  function dragOver(event: PointerEvent) {
    if (!drag?.active) return
    const row = event.target instanceof Element ? event.target.closest("[data-line]") : null
    const line = Number(row?.getAttribute("data-line"))
    if (!Number.isInteger(line) || line < 1) return
    const next = spanLines(drag.anchor, line)
    if (rangeKey(next) !== rangeKey(drag.range)) setDrag({ ...drag, range: next })
  }

  function clickCode(event: MouseEvent) {
    const root = container.current
    if (!navigation || !root || event.button !== 0) return
    const target = targetAt(root, event.clientX, event.clientY)
    if (!target) return
    if (modified(event)) {
      event.preventDefault()
      link(false)
      navigation.onNavigate("definition", target)
    } else {
      navigation.onPoint(target)
    }
  }

  // Zones sit after their line, or at the top past the last line.
  const lineCount = lines.length
  const annotationLine = annotation ? zoneLine(annotation.line, lineCount) : -1
  const focus = annotation?.focus && annotationLine > 0 ? annotation.focus : null
  const commentZones = comments?.zones
  const zonesAt = useMemo(() => {
    const byLine = new Map<number, SourceZone[]>()
    for (const zone of commentZones ?? []) {
      const line = zoneLine(zone.line, lineCount)
      byLine.set(line, [...byLine.get(line) ?? [], zone])
    }
    return byLine
  }, [commentZones, lineCount])
  const zone = (line: number) => {
    const narration = annotationLine === line && annotation ? annotation.render((number) => lines[number - 1]) : null
    const here = zonesAt.get(line)
    if (!narration && !here) return null
    return <span className="source-annotation">{narration}{here?.map((entry) => <Fragment key={entry.key}>{entry.node}</Fragment>)}</span>
  }

  return (
    <div
      ref={container}
      className={`source-document${drag?.active ? " selecting-lines" : ""}${linked ? " navigation-linking" : ""}`}
      role="textbox"
      aria-label={label}
      aria-multiline="true"
      aria-readonly="true"
      tabIndex={0}
      aria-keyshortcuts={comments && range ? "c" : undefined}
      onKeyDown={(event) => {
        // A zone's text field keeps its own keys, as does a card portaled
        // out of the document, such as the blame card.
        if (isTextField(event.target) || !(event.target instanceof Node && event.currentTarget.contains(event.target))) return
        if (navigation && event.key === "F12" && !event.altKey && !modified(event)) {
          event.preventDefault()
          navigation.onNavigate(event.shiftKey ? "references" : "definition", null)
          return
        }
        if (event.key !== "Escape" || !range || !selection) return
        event.preventDefault()
        selectionAnchor.current = null
        selection.onChange(null)
      }}
    >
      <code
        onPointerOver={dragOver}
        onClick={clickCode}
        onPointerMove={navigation ? (event) => {
          pointer.current = { x: event.clientX, y: event.clientY }
          link(modified(event))
        } : undefined}
        onPointerLeave={navigation ? () => {
          pointer.current = null
          link(false)
        } : undefined}
      >
        {zone(0)}
        {lines.map((line, index) => {
          const lineNumber = index + 1
          const selected = shown !== null && lineNumber >= shown.start && lineNumber <= shown.end
          const unfocused = focus ? lineNumber < focus.start || lineNumber > focus.end : false
          const mark = changes ? marks.get(lineNumber) : undefined
          const blamed = blame && activeLine === lineNumber ? blame.render(lineNumber) : null
          return (
            <Fragment key={lineNumber}>
            <span
              className={`source-document-line${activeLine === lineNumber ? " active" : ""}${selected ? " selected" : ""}${unfocused ? " unfocused" : ""}${blamed ? " blamed" : ""}`}
              data-line={lineNumber}
              onClick={() => setActiveLine(lineNumber)}
            >
              <span
                className="source-document-line-number"
                style={{ width: gutterWidth }}
                onMouseDown={(event) => {
                  // Gutter presses select lines, not text; focus moves explicitly.
                  if (selection) event.preventDefault()
                }}
                onPointerDown={(event) => pressGutter(event, lineNumber)}
              >
                <span aria-hidden="true">{lineNumber}</span>
                {selection && !drag?.active && shown?.start === lineNumber && (
                  <LineCopyButton reference={lineReference(selection.path, shown)} />
                )}
                {changes && mark?.bar && (
                  <ChangeMark kind={mark.bar.marker.kind} label={markerLabel(mark.bar.marker)} named={mark.bar.first}
                    onActivate={() => mark.bar && changes.onOpen(mark.bar.marker)} />
                )}
                {changes && mark?.wedge && (
                  <ChangeMark kind="deleted" edge={mark.wedge.edge} label={markerLabel(mark.wedge.marker)}
                    onActivate={() => mark.wedge && changes.onOpen(mark.wedge.marker)} />
                )}
                {/* After the change marks: on the selection's first line it covers them. */}
                {comments && range && !drag?.active && shown?.start === lineNumber && (
                  <LineCommentButton onComment={() => comments.onComment(range)} />
                )}
              </span>
              <SourceLineContent line={line} highlighted={highlightedLines[index]} />
              {blamed && <LineBlame>{blamed}</LineBlame>}
            </span>
            {zone(lineNumber)}
            </Fragment>
          )
        })}
      </code>
    </div>
  )
}
