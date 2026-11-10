# 0120: Review feedback threads

- Status: Accepted
- Date: 2026-11-10
- Extends: [0028](0028-diff-line-links-and-copy.md), [0035](0035-compare-list-and-review-tab.md),
  [0047](0047-walkthroughs.md), [0050](0050-live-updates.md), [0066](0066-lease-levels-and-desktop-events.md),
  [0080](0080-application-layer-contracts-and-transports.md), [0099](0099-desktop-notifications.md)

## Context

A reviewer reading an agent's change in zero tells the agent what to fix by
copying line links into chat, one at a time, and then checks the replies
against code that has moved since. Walkthroughs (0047) go the other way:
the agent explains, the reader reads. Review needs both directions on the
same lines, kept across edits and sessions, and readable by any agent
without a running server.

## Decision

- Feedback is one set of threads per repository and branch, with one stable
  ID: `fb-` and six lowercase letters or digits (generated as random base32,
  so `a-z2-7`). The key is the repository's common git directory, which every
  worktree shares, plus the branch name; a detached HEAD is one bucket per
  repository with branch `""`, and a folder without git keys by its own
  directory. A request's branch is its explicit `id`, else a branch compare's
  `head`, else HEAD's branch, else `""`. The ID is stored with its branch and
  never changes, so an agent can hold it across turns.
- A thread is a conversation, not a single comment: messages by the user or an
  agent, numbered from 1 per thread; thread numbers count from 1 per feedback
  and are never reused. A thread sits on diff lines (either side), a whole
  file in a review, or Source lines in the working tree.
- Statuses are open, resolved, and won't fix. The agent may resolve or close
  a thread itself; the user decides by reading the reply. A user reply
  without a status reopens a closed thread. Awaiting is derived: `agent` when
  open and the last message is the user's, `user` when the last message is
  an agent's, else `none`.
- Agents may start threads too (`zero feedback comment`), on the working
  tree's new side, so they can ask before acting.
- Threads re-anchor by content. At creation the server stores the anchored
  text (20 lines, 2 KiB), 3 lines of context either side, the side's git
  blob hash, and the compare it was written in; clients send only path,
  side, and lines. A thread resolves against a side's current content: same
  blob keeps its lines; otherwise every exact match of the text (trailing
  whitespace ignored) is a candidate, picked by matching context, then
  nearness to the original start, then the earlier. It is `outdated` only
  when the text is gone, the file is missing, or a line thread's side is
  binary or over 8 MiB. File-level threads stay anchored while the file
  exists. Renames resolve under the new path. With a compare, threads
  resolve on their side of that compare; without one, new-side threads
  resolve against the working tree and old-side threads against their own
  compare's old side.
- Feedback lives in the user state directory, never in the project:
  `$XDG_STATE_HOME/zero/feedback` (default `~/.local/state/zero/feedback`)
  on Linux, `~/Library/Application Support/zero/feedback` on macOS, as
  `<sha256 of the repository key>/<id>.json` (0700 directories, 0600 files,
  atomic replace). It is state the user wrote, not a cache to regenerate,
  so it does not sit beside walkthroughs.
- Every read-modify-write holds a per-ID `flock` (`<id>.lock`), and creating
  or evicting holds the repository's lock, so the CLI and any server append
  without losing each other's messages.
- Limits: 500 threads per feedback, 100 messages per thread, 16 KiB per
  message, 200 feedbacks per repository (the least recently updated are
  evicted), 1 MiB per draft request.
- The model, strict decoding, validation (every problem at once, by field,
  as `invalidFeedback`), anchoring, and store live in `internal/feedback`,
  which knows no HTTP and no git. `internal/app` derives keys, reads sides
  through `files.ResolveFile` and `internal/git`, renders message Markdown as
  walkthrough narration is, and announces each write as a `feedback` event
  on the project streams of every followed project in that repository and
  on the daemon control stream. HTTP writes carry walkthrough's guards (JSON
  content type, same Origin, 1 MiB).
- The CLI is the agent's interface, without MCP: `zero feedback show`,
  `reply`, `comment`, and `list` write the store directly, need no server,
  and announce to a running daemon (`POST /_daemon/feedback`) so open pages
  update live. `show` prints stable Markdown of the threads awaiting the
  agent (`--all` for every thread, `--json` for the contract shape), with the
  reply command in its header. MCP would add a server to configure per agent
  for what one shell command already does.
- The page's Copy Prompt copies a short instruction that names the ID and
  the CLI commands; Copy as Markdown copies the same text `show --all`
  prints, for agents without shell access. Each answered anchor carries
  `language`, the registry's highlight language for its current path (never
  stored), so both fence code alike.
- The desktop app (0099) gains a notifier kind `feedback`: an agent's write
  on a followed project notifies "Agent replied on <branch>" with "N threads
  awaiting you" and routes to `/view?fb=<id>` for that project, under the
  usual limiter. The bridge's `configureNotifications` payload gains an
  optional `feedback` setting; absent means off, so older servers keep
  working.

## Consequences

- Feedback is per machine and per user, not shared through git or with
  other reviewers.
- Worktrees of one repository share a branch's feedback; renaming a branch
  starts new feedback, and the old one stays listed until evicted.
- Re-anchoring finds the exact text only: reworded code makes a thread
  outdated, shown with its original text, rather than guessed at.
- Any local process can write feedback; message HTML is always escaped.
- The CLI writes without the daemon's knowledge when none runs; pages pick
  the change up when they next read.
