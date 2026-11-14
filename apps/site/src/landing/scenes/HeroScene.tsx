'use client'

// The hero: review feedback round trip (decision 0120). The reader selects a
// changed line, comments on it, the agent reads and answers from its shell,
// and the reply lands in the thread, resolved.

import { CircleCheckIcon, CircleDotIcon, GitCompareArrowsIcon, MessageSquarePlusIcon } from 'lucide-react'
import { Caret, Collapse, Draft, Prompt, Roll, Stage, States, Window, type Act } from '../kit'
import { DiffLine, FileBand, Tabs, ZeroWindow, fn, kw, num, str, type DiffLineSpec } from './app'
import './hero.css'

type S = {
  selected: boolean
  composer: boolean
  draft: string
  typing: boolean
  posted: boolean
  terminal: boolean
  show: string
  shown: boolean
  reply: string
  replied: boolean
  answer: boolean
  resolved: boolean
  folded: boolean
}

const COMMENT = 'Does /health need the session check too?'
const ANSWER = 'No: health checks run without a session, so /health stays public. Kept it outside the middleware.'
const SHOW = 'zero feedback show'
const REPLY = 'zero feedback reply fb-q7rk2m 1 --resolve'

const initial: S = {
  selected: false,
  composer: false,
  draft: '',
  typing: false,
  posted: false,
  terminal: false,
  show: '',
  shown: false,
  reply: '',
  replied: false,
  answer: false,
  resolved: false,
  folded: false,
}

const POSTER: S = { ...initial, selected: true, composer: true, draft: COMMENT, posted: true, answer: true, resolved: true }

const before: DiffLineSpec[] = [
  { old: 4, new: 4, kind: 'context', code: <>{kw('export function')} {fn('route')}(app) {'{'}</> },
  { old: 5, kind: 'del', code: <>{'  '}app.get({str('"/orders"')}, checkExpiry, orders)</> },
]

const commented: DiffLineSpec = { new: 5, kind: 'add', code: <>{'  '}app.use(requireFreshSession)</> }

const after: DiffLineSpec[] = [
  { new: 6, kind: 'add', code: <>{'  '}app.get({str('"/orders"')}, orders)</> },
  { old: 6, new: 7, kind: 'context', code: <>{'  '}app.get({str('"/billing"')}, billing)</> },
  { old: 7, new: 8, kind: 'context', code: '}' },
  { old: 8, new: 9, kind: 'context', code: '' },
  { old: 9, new: 10, kind: 'context', code: <>{kw('export function')} {fn('health')}(app) {'{'}</> },
  { old: 10, new: 11, kind: 'context', code: <>{'  '}app.get({str('"/health"')}, ok)</> },
  { old: 11, new: 12, kind: 'context', code: '}' },
]

const session: DiffLineSpec[] = [
  { new: 1, kind: 'add', code: <>{kw('const')} maxAge = {num('30')} * {num('60')} * {num('1000')}</> },
  { new: 2, kind: 'add', code: '' },
  { new: 3, kind: 'add', code: <>{kw('export function')} {fn('requireFreshSession')}(req, res, next) {'{'}</> },
  { new: 4, kind: 'add', code: <>{'  '}{kw('const')} at = req.session?.issuedAt ?? {num('0')}</> },
  { new: 5, kind: 'add', code: <>{'  '}{kw('if')} (Date.now() - at &gt; maxAge) {'{'}</> },
]

// The compact design shows the new side's numbers only.
const newOnly = (line: DiffLineSpec): DiffLineSpec => ({ ...line, old: line.new === undefined ? line.old : undefined })

async function script(a: Act<S>) {
  await a.wait(700)

  // Select the changed line by its number.
  await a.move({ at: 'line', x: 0.5, y: 0.5 })
  await a.wait(250)
  await a.click()
  await a.set({ selected: true })
  await a.wait(450)

  // c opens the composer under it; the comment is typed and sent.
  await a.move('rest')
  await a.key('c')
  await a.set({ composer: true, typing: true })
  await a.wait(500)
  await a.type('draft', COMMENT)
  await a.wait(350)
  await a.key('ctrl+enter')
  await a.set({ typing: false, posted: true })
  await a.wait(1100)

  // The agent reads the thread from its shell and replies.
  await a.set({ terminal: true })
  await a.wait(700)
  await a.type('show', SHOW, { interval: 28 })
  await a.wait(250)
  await a.set({ shown: true })
  await a.wait(1300)
  await a.type('reply', REPLY, { interval: 22 })
  await a.wait(250)
  await a.set({ replied: true })
  await a.wait(700)

  // The reply lands in the thread, and the thread resolves.
  await a.set({ terminal: false })
  await a.wait(250)
  await a.set({ answer: true })
  await a.wait(350)
  await a.set({ resolved: true })
  await a.wait(2600)

  // A resolved thread folds to its one line, as the app folds it, then the
  // selection clears and the next round starts from the plain diff.
  await a.set({ folded: true })
  await a.wait(900)
  await a.set({ composer: false, selected: false })
  await a.wait(700)
  await a.snap({ ...initial })
}

function Thread({ s }: { s: S }) {
  return (
    <div className="hs-thread" data-posted={s.posted || undefined}>
      <Collapse open={!s.folded}>
        <div className="hs-thread-head">
          <span className="hs-thread-status" data-resolved={s.resolved || undefined}>
            <States value={!s.posted ? 'new' : s.resolved ? 'resolved' : 'open'} states={{ new: <MessageSquarePlusIcon />, open: <CircleDotIcon />, resolved: <CircleCheckIcon /> }} />
            <Roll>{!s.posted ? 'New comment' : s.resolved ? 'Resolved' : 'Open'}</Roll>
          </span>
          <span className="hs-thread-place">src/routes.ts:5</span>
        </div>
        <div className="hs-message">
          <span className="hs-author">
            you<span className="hs-time" data-show={s.posted || undefined}>just now</span>
          </span>
          <Draft className="hs-draft" value={s.draft} full={COMMENT} editing={s.typing} placeholder="Leave a comment" />
        </div>
        <Collapse open={!s.posted}>
          <div className="hs-composer-foot">
            <span className="hs-hint">Markdown · Ctrl+Enter</span>
            <span className="hs-button">Cancel</span>
            <span className="hs-button hs-button-primary">Comment</span>
          </div>
        </Collapse>
        <Collapse open={s.answer} reveal="drop">
          <div className="hs-message">
            <span className="hs-author hs-agent">
              agent<span className="hs-time" data-show>just now</span>
            </span>
            <span className="hs-words">{ANSWER}</span>
            <span className="hs-event">resolved this</span>
          </div>
        </Collapse>
      </Collapse>
      <Collapse open={s.folded}>
        <div className="hs-folded">
          <CircleCheckIcon />
          <span>{COMMENT}</span>
        </div>
      </Collapse>
    </div>
  )
}

export function HeroScene() {
  return (
    <Stage
      width={728}
      height={500}
      compact={{ below: 560, width: 358, height: 356 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: { wide: { x: 560, y: 150 }, compact: { x: 300, y: 130 } } }}
      keys={{ wide: 'bottom-right', compact: 'bottom-right' }}
      className="zs hs"
    >
      {(s, _rect, layout) => (
        <>
          <ZeroWindow className="hs-window" title="vs main · api" active="source">
            <Tabs tabs={[{ name: 'vs main', icon: <GitCompareArrowsIcon />, active: true }, { name: 'session.ts' }]} />
            <div className="zs-file">
              <FileBand path="src/routes.ts" add={3} del={2} status="M" viewed={false} />
              <div className="zs-lines">
                {before.map((line, index) => (
                  <DiffLine key={index} line={layout === 'compact' ? newOnly(line) : line} />
                ))}
                <DiffLine line={layout === 'compact' ? newOnly(commented) : commented} selected={s.selected} data-target="line" data-cursor="pointer" />
                <Collapse open={s.composer} reveal="drop">
                  <Thread s={s} />
                </Collapse>
                {after.map((line, index) => (
                  <DiffLine key={index} line={layout === 'compact' ? newOnly(line) : line} />
                ))}
              </div>
            </div>
            <div className="zs-file">
              <FileBand path="src/middleware/session.ts" add={9} del={0} status="A" viewed={false} />
              <div className="zs-lines">
                {session.map((line, index) => (
                  <DiffLine key={index} line={layout === 'compact' ? newOnly(line) : line} />
                ))}
              </div>
            </div>
          </ZeroWindow>

          <Window chrome="terminal" title="api — zsh" className="hs-terminal" data-show={s.terminal || undefined}>
            <Prompt path="~/code/api">
              {s.show}
              <span className="hs-caret" data-off={s.shown || undefined}>
                <Caret still={s.show.length > 0 && s.show.length < SHOW.length} />
              </span>
            </Prompt>
            <Collapse open={s.shown}>
              <div className="hs-out">
                <div className="hs-out-head"># Feedback fb-q7rk2m · 1 thread awaiting you</div>
                <div>## Thread 1 · open · src/routes.ts:5</div>
                <div className="dim">user: {COMMENT}</div>
              </div>
            </Collapse>
            {s.shown ? (
              <Prompt path="~/code/api">
                {s.reply}
                <span className="hs-caret" data-off={s.replied || undefined}>
                  <Caret still={s.reply.length > 0 && s.reply.length < REPLY.length} />
                </span>
              </Prompt>
            ) : null}
            <Collapse open={s.replied}>
              <div className="ok">replied to thread 1 (resolved)</div>
            </Collapse>
          </Window>
          <span data-target="rest" className="hs-rest" />
        </>
      )}
    </Stage>
  )
}
