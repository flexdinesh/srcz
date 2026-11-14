'use client'

// Browse: the Explorer beside a README rendered in Preview, with its diagram
// and a fenced YAML block. A still.

import { ChevronDownIcon, ChevronRightIcon, FileCodeIcon, FileIcon, FileTextIcon, FolderIcon, FolderOpenIcon, ImageIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Segmented, Stage } from '../kit'
import { Tabs, ZeroWindow } from './app'
import './browse.css'

type Entry = { name: string; depth: number; kind: 'open' | 'closed' | 'file'; icon?: ReactNode; selected?: boolean }

const tree: Entry[] = [
  { name: 'docs', depth: 0, kind: 'closed' },
  { name: 'internal', depth: 0, kind: 'closed' },
  { name: 'src', depth: 0, kind: 'open' },
  { name: 'routes.ts', depth: 1, kind: 'file', icon: <FileCodeIcon /> },
  { name: 'server.ts', depth: 1, kind: 'file', icon: <FileCodeIcon /> },
  { name: 'config.yaml', depth: 0, kind: 'file', icon: <FileIcon /> },
  { name: 'logo.png', depth: 0, kind: 'file', icon: <ImageIcon /> },
  { name: 'README.md', depth: 0, kind: 'file', icon: <FileTextIcon />, selected: true },
  { name: 'package.json', depth: 0, kind: 'file', icon: <FileIcon /> },
]

function Explorer() {
  return (
    <div className="bs-explorer">
      <div className="bs-explorer-head">
        <span className="bs-project">api</span>
        <span className="bs-branch">main</span>
      </div>
      {tree.map((entry) => (
        <div key={entry.name} className="bs-entry" data-selected={entry.selected === true || undefined} style={{ paddingLeft: 10 + entry.depth * 14 }}>
          <span className="bs-chevron">{entry.kind === 'open' ? <ChevronDownIcon /> : entry.kind === 'closed' ? <ChevronRightIcon /> : null}</span>
          <span className="bs-icon">{entry.kind === 'open' ? <FolderOpenIcon /> : entry.kind === 'closed' ? <FolderIcon /> : entry.icon}</span>
          <span className="bs-name">{entry.name}</span>
        </div>
      ))}
    </div>
  )
}

function Diagram() {
  return (
    <svg className="bs-diagram" viewBox="0 0 296 40" aria-hidden>
      <rect x="0.5" y="6.5" width="76" height="27" />
      <rect x="110.5" y="6.5" width="76" height="27" />
      <rect x="219.5" y="6.5" width="76" height="27" />
      <path d="M77 20h28M187 20h27" />
      <path className="bs-diagram-head" d="m101 16 5 4-5 4M210 16l5 4-5 4" />
      <text x="38.5" y="24">request</text>
      <text x="148.5" y="24">router</text>
      <text x="257.5" y="24">handler</text>
    </svg>
  )
}

export function BrowseScene() {
  return (
    <Stage width={728} height={420} compact={{ below: 560, width: 358, height: 356 }} initial={{}} className="zs bs">
      {() => (
        <ZeroWindow className="bs-window" title="README.md · api" active="files" side={<Explorer />}>
          <Tabs
            tabs={[{ name: 'README.md', icon: <FileTextIcon />, active: true }, { name: 'config.yaml' }, { name: 'logo.png' }]}
            trailing={<Segmented className="bs-mode" items={['Preview', 'Source']} value={0} />}
          />
          <div className="bs-preview">
            <div className="bs-h1">api</div>
            <p className="bs-p">Routes requests to handlers. Start the server, then open the dashboard.</p>
            <Diagram />
            <div className="bs-h2">Configuration</div>
            <pre className="bs-fence">
              <span className="zs-fn">server</span>:{'\n'}
              {'  '}
              <span className="zs-fn">port</span>: <span className="zs-num">8080</span>
              {'\n'}
              {'  '}
              <span className="zs-fn">timeout</span>: <span className="zs-str">30s</span>
            </pre>
          </div>
        </ZeroWindow>
      )}
    </Stage>
  )
}
