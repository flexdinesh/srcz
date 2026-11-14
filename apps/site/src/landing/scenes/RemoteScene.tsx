'use client'

// Remote (decision 0098): the host's shell serves a folder with --remote and
// prints the connect line; the desktop app shows that machine in a window of
// its own. Overlapping windows: the shell in front, its right edge on the
// window's sidebar line, covering only the tree's filler rows.

import { ChevronDownIcon, ChevronRightIcon, FileTextIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Bar, Prompt, Stage, Window } from '../kit'
import { Tabs, ZeroWindow } from './app'
import './remote.css'

type Row = { name: string; depth: number; folder?: 'open' | 'closed'; selected?: boolean }

const rows: Row[] = [
  { name: 'foo', depth: 0, folder: 'open' },
  { name: 'cmd', depth: 1, folder: 'closed' },
  { name: 'internal', depth: 1, folder: 'closed' },
  { name: 'go.mod', depth: 1 },
  { name: 'README.md', depth: 1, selected: true },
]

function TreeRow({ row }: { row: Row }) {
  const chevron = row.folder === 'open' ? <ChevronDownIcon /> : row.folder === 'closed' ? <ChevronRightIcon /> : <span />
  const icon = row.folder === 'open' ? <FolderOpenIcon /> : row.folder === 'closed' ? <FolderIcon /> : <FileTextIcon />
  return (
    <div className="rs-row" data-selected={row.selected === true || undefined} style={{ paddingLeft: 8 + row.depth * 14 }}>
      <span className="rs-chevron">{chevron}</span>
      <span className="rs-icon" data-folder={row.folder === undefined ? undefined : true}>
        {icon}
      </span>
      <span>{row.name}</span>
    </div>
  )
}

function Explorer() {
  return (
    <div className="rs-explorer">
      <div className="rs-explorer-head">Explorer</div>
      {rows.map((row) => (
        <TreeRow key={row.name} row={row} />
      ))}
      {[64, 48, 72, 56].map((w, index) => (
        <div key={index} className="rs-row rs-filler" style={{ paddingLeft: 22 }}>
          <Bar w={12} h={10} r={2} tone={2} />
          <Bar w={w} h={6} tone={2} />
        </div>
      ))}
    </div>
  )
}

function Readme({ children }: { children: ReactNode }) {
  return <div className="rs-readme">{children}</div>
}

export function RemoteScene() {
  return (
    <Stage width={728} height={450} compact={{ below: 560, width: 358, height: 356 }} initial={{}} className="zs rs">
      {() => (
        <>
          <ZeroWindow className="rs-window" title="Zero: box" active="files" side={<Explorer />}>
            <Tabs tabs={[{ name: 'README.md', icon: <FileTextIcon />, active: true }]} />
            <Readme>
              <div className="rs-h1">foo</div>
              <div className="rs-p">Exports nightly order files to the warehouse, from the box that holds them.</div>
              <div className="rs-h2">Running</div>
              <div className="rs-bars">
                <Bar w="92%" h={6} tone={2} />
                <Bar w="78%" h={6} tone={2} />
                <Bar w="84%" h={6} tone={2} />
                <Bar w="40%" h={6} tone={2} />
              </div>
              <div className="rs-code">
                <Bar w="46%" h={6} tone={3} />
                <Bar w="62%" h={6} tone={3} />
              </div>
            </Readme>
          </ZeroWindow>

          <Window chrome="terminal" title="dee@box — ssh" className="rs-terminal">
            <Prompt path="box:~">zero ~/code/foo --remote</Prompt>
            <div>  zero 1.4.0</div>
            <div>  serving directory:  /home/dee/code/foo</div>
            <div className="rs-gap">  on your computer, run:</div>
            <div className="rs-connect">  zero connect 10.0.0.5:7971/&lt;credential&gt;</div>
          </Window>
        </>
      )}
    </Stage>
  )
}
