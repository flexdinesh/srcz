// The feature rows' panes: compact HTML replicas of the app in its slate language.
// Every file, branch, and note in them is synthetic demo content.

import type { ReactNode } from 'react'
import { Box, BoxCheck, ChevronDown } from './icons'
import type { FeatureId } from './features'

type Tab = { name: string; meta?: string; active?: boolean }

function Tabs({ tabs, trailing }: { tabs: Tab[]; trailing?: ReactNode }) {
  return (
    <div className="pane-tabs">
      {tabs.map((tab) => (
        <span key={tab.name} className={tab.active === true ? 'pane-tab pane-tab-active' : 'pane-tab'}>
          {tab.name}
          {tab.meta === undefined ? null : <span className="pane-dim">· {tab.meta}</span>}
        </span>
      ))}
      {trailing}
    </div>
  )
}

function Status({ children }: { children: ReactNode }) {
  return <div className="pane-status">{children}</div>
}

function Counts({ add, del }: { add: number; del?: number }) {
  return (
    <>
      <span className="pane-add">+{add}</span>
      {del === undefined ? null : <span className="pane-del">−{del}</span>}
    </>
  )
}

function FileBand({ path, add, del, viewed }: { path: string; add: number; del?: number; viewed: boolean }) {
  return (
    <div className="pane-band">
      <span>{path}</span>
      <Counts add={add} del={del} />
      <span className="pane-viewed">
        {viewed ? <BoxCheck /> : <Box />}
        <span className="pane-viewed-label">Viewed</span>
      </span>
    </div>
  )
}

type DiffLine = { old?: number; new?: number; kind: 'context' | 'add' | 'del'; text: string }

const routesDiff: DiffLine[] = [
  { old: 41, new: 41, kind: 'context', text: '  export function route(app) {' },
  { old: 42, kind: 'del', text: '-   app.get("/orders", checkExpiry, orders)' },
  { old: 43, kind: 'del', text: '-   app.get("/billing", billing)' },
  { new: 42, kind: 'add', text: '+   app.use(requireFreshSession)' },
  { new: 43, kind: 'add', text: '+   app.get("/orders", orders)' },
  { new: 44, kind: 'add', text: '+   app.get("/billing", billing)' },
  { old: 44, new: 45, kind: 'context', text: '  }' },
]

const routesTail: DiffLine[] = [
  { old: 45, new: 46, kind: 'context', text: '' },
  { old: 46, new: 47, kind: 'context', text: '  export function health(app) {' },
  { old: 47, new: 48, kind: 'context', text: '    app.get("/health", ok)' },
  { old: 48, new: 49, kind: 'context', text: '  }' },
]

const sessionDiff: DiffLine[] = [
  { new: 1, kind: 'add', text: '+ const maxAge = 30 * 60 * 1000' },
  { new: 2, kind: 'add', text: '+' },
  { new: 3, kind: 'add', text: '+ export function requireFreshSession(' },
  { new: 4, kind: 'add', text: '+   req, res, next,' },
  { new: 5, kind: 'add', text: '+ ) {' },
  { new: 6, kind: 'add', text: '+   const at = req.session?.issuedAt ?? 0' },
  { new: 7, kind: 'add', text: '+   if (Date.now() - at > maxAge) {' },
  { new: 8, kind: 'add', text: '+     return res.status(401).end()' },
  { new: 9, kind: 'add', text: '+   }' },
  { new: 10, kind: 'add', text: '+   next()' },
  { new: 11, kind: 'add', text: '+ }' },
]

function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="pane-code">
      {lines.map((line, index) => (
        <div key={index} className={`pane-diff pane-diff-${line.kind}`}>
          <span className="pane-ln">{line.old ?? ''}</span>
          <span className="pane-ln">{line.new ?? ''}</span>
          <span className="pane-text">{line.text}</span>
        </div>
      ))}
    </div>
  )
}

function Note({ pin, title, children }: { pin: number; title: string; children: ReactNode }) {
  return (
    <div className="pane-note">
      <p className="pane-note-title">
        <span className="pane-pin">{pin}</span>
        {title}
      </p>
      <p>{children}</p>
      <div className="pane-note-actions" aria-hidden="true">
        <span className="pane-chip">Previous</span>
        <span className="pane-chip pane-chip-accent">Next</span>
        <span className="pane-chip">Close</span>
      </div>
    </div>
  )
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="pane" aria-label={`${label} (synthetic demo)`}>
      <figcaption className="pane-caption">
        <span>{label}</span>
        <span>synthetic demo</span>
      </figcaption>
      <div className="pane-app">{children}</div>
    </figure>
  )
}

function ReviewPane() {
  return (
    <Frame label="srcz ~/code/api">
      <Tabs tabs={[{ name: 'routes.ts', meta: 'step 1 of 4', active: true }, { name: 'session.ts' }, { name: 'README.md' }]} />
      <div className="pane-band">
        <span>src/routes.ts</span>
        <span className="pane-chip">agent/session-expiry</span>
        <Counts add={3} del={2} />
        <span className="pane-viewed">
          <Box />
          <span className="pane-viewed-label">Viewed</span>
        </span>
      </div>
      <div className="pane-body">
        <Diff lines={routesDiff} />
        <Note pin={1} title="Session expiry fix · step 1 of 4">
          The agent moved the expiry check into one middleware, so every route shares it.{' '}
          <code>/billing</code> was unprotected before.
        </Note>
        <Diff lines={routesTail} />
      </div>
      <Status>
        <span>agent/session-expiry → main</span>
        <span>3 commits · 4 files</span>
        <span className="pane-status-end">read-only</span>
      </Status>
    </Frame>
  )
}

function Tree({ rows }: { rows: { name: string; depth?: number; selected?: boolean; trailing?: string }[] }) {
  return (
    <>
      {rows.map((row) => (
        <div
          key={row.name}
          className={row.selected === true ? 'pane-row pane-row-selected' : 'pane-row'}
          style={{ paddingLeft: `${0.625 + (row.depth ?? 0) * 0.875}rem` }}
        >
          <span className="pane-row-name">{row.name}</span>
          {row.trailing === undefined ? null : <span className="pane-row-trailing">{row.trailing}</span>}
        </div>
      ))}
    </>
  )
}

function BrowsePane() {
  return (
    <Frame label="srcz ~/code/api">
      <Tabs
        tabs={[{ name: 'README.md', active: true }, { name: 'config.yaml' }, { name: 'logo.png' }]}
        trailing={
          <span className="pane-toggle">
            <span className="pane-toggle-on">Preview</span>
            <span>Source</span>
          </span>
        }
      />
      <div className="pane-split">
        <div className="pane-side">
          <p className="pane-side-head">Explorer</p>
          <Tree
            rows={[
              { name: 'api' },
              { name: 'docs', depth: 1 },
              { name: 'internal', depth: 1 },
              { name: 'config.yaml', depth: 1 },
              { name: 'logo.png', depth: 1 },
              { name: 'README.md', depth: 1, selected: true },
              { name: 'server.go', depth: 1 },
            ]}
          />
        </div>
        <div className="pane-body pane-prose">
          <h3>api</h3>
          <p>Routes requests to handlers. Start the server, then open the dashboard.</p>
          <svg className="pane-diagram" viewBox="0 0 300 56" role="img" aria-label="request, router, handler">
            <rect x="1" y="14" width="80" height="28" />
            <rect x="110" y="14" width="80" height="28" />
            <rect x="219" y="14" width="80" height="28" />
            <path d="M81 28h25M190 28h25" />
            <path className="pane-diagram-head" d="m101 24 6 4-6 4M210 24 216 28l-6 4" />
            <text x="41" y="32">request</text>
            <text x="150" y="32">router</text>
            <text x="259" y="32">handler</text>
          </svg>
          <pre>
            <span className="pane-key">server</span>:{'\n'}
            {'  '}
            <span className="pane-key">port</span>: <span className="pane-num">8080</span>
            {'\n'}
            {'  '}
            <span className="pane-key">timeout</span>: <span className="pane-str">30s</span>
          </pre>
        </div>
      </div>
      <Status>
        <span>Markdown</span>
        <span className="pane-status-end">2.1 KB</span>
      </Status>
    </Frame>
  )
}

function DiffsPane() {
  return (
    <Frame label="srcz ~/code/api · source control">
      <div className="pane-split">
        <div className="pane-side">
          <p className="pane-side-head">
            Base: main <ChevronDown />
          </p>
          <p className="pane-side-group">Uncommitted · 1</p>
          <Tree rows={[{ name: 'M routes.ts', depth: 1 }]} />
          <p className="pane-side-group">Commits · 3</p>
          <Tree
            rows={[
              { name: '9f3c2e1 expire by age', depth: 1, selected: true },
              { name: '41ab0d7 add middleware', depth: 1 },
              { name: 'c02e9f4 session tests', depth: 1 },
            ]}
          />
          <p className="pane-side-group">Branches</p>
          <Tree rows={[{ name: 'agent/session-expiry', depth: 1 }]} />
        </div>
        <div className="pane-body pane-stack">
          <FileBand path="routes.ts" add={3} del={2} viewed />
          <Diff lines={routesDiff} />
          <FileBand path="middleware/session.ts" add={11} viewed={false} />
          <Diff lines={sessionDiff} />
          <FileBand path="session.test.ts" add={41} viewed={false} />
        </div>
      </div>
      <Status>
        <span>main…agent/session-expiry</span>
        <span>4 files</span>
        <span className="pane-add">+59</span>
        <span className="pane-del">−2</span>
        <span className="pane-status-end">1 / 4 viewed</span>
      </Status>
    </Frame>
  )
}

type SourceLine = { n: number; highlight?: boolean; content: ReactNode }

const sessionSource: SourceLine[] = [
  {
    n: 12,
    content: (
      <>
        <span className="pane-kw">export function</span> <span className="pane-fn">requireFreshSession</span>(req, res,
        next) {'{'}
      </>
    ),
  },
  {
    n: 13,
    highlight: true,
    content: (
      <>
        {'  '}
        <span className="pane-kw">const</span> age = Date.now() - req.session.issuedAt
      </>
    ),
  },
  {
    n: 14,
    highlight: true,
    content: (
      <>
        {'  '}
        <span className="pane-kw">if</span> (age &gt; MAX_AGE) <span className="pane-kw">return</span> res.redirect(
        <span className="pane-str">"/login"</span>)
      </>
    ),
  },
]

const sessionTail: SourceLine[] = [
  { n: 15, content: '  next()' },
  { n: 16, content: '}' },
]

function Source({ lines }: { lines: SourceLine[] }) {
  return (
    <div className="pane-code">
      {lines.map((line) => (
        <div key={line.n} className={line.highlight === true ? 'pane-src pane-src-highlight' : 'pane-src'}>
          <span className="pane-ln">{line.n}</span>
          <span className="pane-text">{line.content}</span>
        </div>
      ))}
    </div>
  )
}

function WalkthroughPane() {
  return (
    <Frame label="srcz ~/code/api · walkthroughs">
      <div className="pane-split">
        <div className="pane-side">
          <p className="pane-side-head">Walkthroughs · 3</p>
          <Tree
            rows={[
              { name: 'Session expiry fix', selected: true, trailing: '4' },
              { name: 'Cache invalidation', trailing: '6' },
              { name: 'Billing retries', trailing: '3' },
            ]}
          />
          <p className="pane-side-group">Steps</p>
          <Tree
            rows={[
              { name: '1 · routes.ts' },
              { name: '2 · session.ts', selected: true },
              { name: '3 · session.test.ts' },
              { name: '4 · README.md' },
            ]}
          />
        </div>
        <div className="pane-main">
          <Tabs tabs={[{ name: 'session.ts', meta: 'step 2 of 4', active: true }, { name: 'routes.ts' }]} />
          <div className="pane-body">
            <Source lines={sessionSource} />
            <Note pin={2} title="Step 2 of 4">
              Age is measured from <code>issuedAt</code>, not last activity, so long sessions now expire on schedule.
            </Note>
            <Source lines={sessionTail} />
          </div>
        </div>
      </div>
      <Status>
        <span>pinned to 9f3c2e1</span>
        <span className="pane-status-end">read-only</span>
      </Status>
    </Frame>
  )
}

function RemotePane() {
  return (
    <figure className="pane pane-remote" aria-label="Serving a remote host to a laptop (synthetic demo)">
      <figcaption className="pane-caption">
        <span>on the host · ssh dee@box</span>
        <span>synthetic demo</span>
      </figcaption>
      <pre className="pane-term">
        <span className="pane-prompt">$</span> srcz ~/code/foo --remote{'\n'}
        {'  '}srcz 1.4.0{'\n'}
        {'  '}serving directory: /home/dee/code/foo{'\n\n'}
        {'  '}on your computer, run:{'\n'}
        {'  '}
        <span className="pane-strong">srcz connect 10.0.0.5:7971/&lt;credential&gt;</span>
      </pre>
      <p className="pane-caption">
        <span>on your laptop</span>
      </p>
      <pre className="pane-term">
        <span className="pane-prompt">$</span> srcz connect 10.0.0.5:7971/&lt;credential&gt;
      </pre>
      <div className="pane-app pane-window">
        <Tabs tabs={[{ name: 'srcz://r-3f9a1c2b7d4e/', meta: 'foo', active: true }]} />
        <div className="pane-split">
          <div className="pane-side">
            <Tree rows={[{ name: 'foo' }, { name: 'cmd', depth: 1 }, { name: 'README.md', depth: 1, selected: true }]} />
          </div>
          <div className="pane-body pane-prose">
            <h3>foo</h3>
            <p>Served from the host over pinned TLS with a token, in its own window, tabs, and settings.</p>
          </div>
        </div>
      </div>
    </figure>
  )
}

const facts = [
  { title: 'Read-only', detail: 'files never change' },
  { title: '1 binary', detail: 'Go, web app embedded' },
  { title: 'No Electron', detail: 'desktop uses the OS web view' },
  { title: 'No git binary', detail: 'reads git objects directly' },
  { title: 'No CDN', detail: 'every asset bundled' },
  { title: 'Idle exit', detail: 'daemon stops after 30 idle min' },
]

function LeanPane() {
  return (
    <Frame label="srcz · facts">
      <Tabs tabs={[{ name: 'facts', active: true }]} />
      <dl className="pane-facts">
        {facts.map((fact) => (
          <div key={fact.title} className="pane-fact">
            <dt>{fact.title}</dt>
            <dd>{fact.detail}</dd>
          </div>
        ))}
      </dl>
      <pre className="pane-term pane-term-flat">
        <span className="pane-prompt">$</span> which srcz{'\n'}
        /home/dee/.local/bin/srcz{'\n'}
        <span className="pane-prompt">$</span> srcz daemon status{'\n'}
        srcz daemon 1.4.0 (protocol 1) at /run/user/1000/srcz/daemon.sock, pid 4182, 2 roots
      </pre>
      <Status>
        <span>one binary</span>
        <span className="pane-status-end">idle exit after 30 min</span>
      </Status>
    </Frame>
  )
}

export function FeaturePane({ id }: { id: FeatureId }) {
  switch (id) {
    case 'overview':
      return <ReviewPane />
    case 'browse':
      return <BrowsePane />
    case 'diffs':
      return <DiffsPane />
    case 'walkthroughs':
      return <WalkthroughPane />
    case 'remote':
      return <RemotePane />
    case 'lean':
      return <LeanPane />
  }
}
