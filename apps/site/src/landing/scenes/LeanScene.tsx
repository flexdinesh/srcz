'use client'

// Lean (decisions 0105, 0141): facts, not benchmarks. A shell finds the one
// binary, opens a folder in the desktop app, and asks the daemon how it runs;
// a short ledger of what zero does without straddles the shell's left edge,
// over its empty lower half. The compact design skips the open.

import { CheckIcon } from 'lucide-react'
import { Caret, Prompt, Stage, Window } from '../kit'
import './lean.css'

const facts = ['Read-only', 'One binary', 'No Electron', 'No git binary', 'No CDN', 'Idle exit']

export function LeanScene() {
  return (
    <Stage width={728} height={486} compact={{ below: 560, width: 358, height: 356 }} initial={{}} className="zs ls">
      {(_state, _rect, layout) => (
        <>
          <Window chrome="terminal" title="~ — zsh" className="ls-terminal">
            <Prompt path="~">which zero</Prompt>
            <div>/home/dee/.local/bin/zero</div>
            {layout === 'wide' ? (
              <>
                <Prompt path="~">zero ~/code/api</Prompt>
                <div>opened /home/dee/code/api in zero</div>
                <div className="dim">desktop: zero://local/?project=%2Fhome%2Fdee%2Fcode%2Fapi</div>
              </>
            ) : null}
            <Prompt path="~">zero daemon status</Prompt>
            <div className="ls-status">zero daemon 1.4.0 (protocol 1) at /run/user/1000/zero/daemon.sock, pid 4182, 1 root</div>
            <Prompt path="~">
              <Caret />
            </Prompt>
          </Window>

          <div className="ls-facts">
            {facts.map((fact) => (
              <div key={fact} className="ls-fact">
                <CheckIcon />
                <span>{fact}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Stage>
  )
}
