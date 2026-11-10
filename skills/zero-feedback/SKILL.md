---
name: zero-feedback
description: Read and answer review feedback a user left in Zero, comment threads on diff lines, whole files, and Source lines of a branch, with the `zero feedback` CLI. Use when the user asks you to address, apply, or reply to their Zero feedback or review comments, gives you a feedback id such as fb-3k2q8m, or wants you to raise something on their code in Zero.
---

# Zero review feedback

Commands use the canonical `zero`. If installed as `zero-cli` or with
`--name NAME`, substitute the chosen command for `zero` in every example.
Only the exposed CLI name changes; `zero-desktop`, `zero://` links, and
Zero's configuration and data paths keep their canonical names.

Feedback is a set of comment threads a user writes while reviewing code in
Zero: on lines of a diff (either side), on a whole file in a review, or on
lines of a file in Source. All threads of one repository and branch share one
feedback id, `fb-` and six characters, which never changes. Each thread is a
conversation between the user and agents:

- **Number**: threads count from 1 within the feedback and keep their number.
- **Status**: `open`, `resolved`, or `wontfix`. You may resolve a thread
  yourself once you have made the change.
- **Awaiting**: a thread awaits you when it is open and the user wrote last;
  it awaits the user when you wrote last.
- **Location**: threads follow their code as it changes. A thread whose lines
  moved shows `(moved from 38-40)`; one whose code is gone is `outdated` and
  still shows the text it was written on.

No running server is needed: the CLI reads and writes Zero's store directly,
and any open Zero window updates within a second.

## 1. Read what waits on you

```sh
zero feedback show fb-3k2q8m
```

Without an id, `zero feedback show` uses the current directory's repository
and checked-out branch; `--project DIR` names another repository or worktree
root. It prints Markdown:

````
# Feedback fb-3k2q8m
Branch feature/greeting · /home/user/markdown · 2 threads awaiting you

Reply: zero feedback reply fb-3k2q8m <thread> -m "<what you did>" [--resolve | --wontfix]

## Thread 1 · open · code/main.go:7
```go
	fmt.Println("hello from zero") // go-search-token
```
**user** · 2026-11-10 09:12 UTC
Keep the greeting in a constant so the CLI and tests share it.
````

| Option | Effect |
| --- | --- |
| `--all` | Every thread, not only those awaiting you |
| `--json` | The feedback as JSON: threads with `number`, `status`, `awaiting`, `anchor`, `location`, and `messages` |
| `--project DIR` | The repository or worktree root, when no id is given |

Location labels read `path:7` or `path:12-20`; `(old side)` means removed
lines, numbered as before the change; `path (file)` is about the whole file.
`No threads awaiting you.` means there is nothing to do.

`zero feedback list` prints one line per branch with feedback in the
repository: `fb-3k2q8m  feature/greeting  4 threads, 2 awaiting you`.

## 2. Work through the threads

For each thread awaiting you, in order:

1. Read the code at its location and the whole conversation, not only the
   last message.
2. Make the change, or decide why not.
3. Reply, once per thread:

```sh
zero feedback reply fb-3k2q8m 1 -m "Moved the greeting to \`greeting\` in code/main.go:5; main and main_test.go use it." --resolve
```

| Outcome | Reply |
| --- | --- |
| Done | `-m "<what you changed, and where>" --resolve` |
| Declined | `-m "<why not>" --wontfix` |
| Unclear | `-m "<your question>"` with no status; the thread stays open and awaits the user |
| Reopen a closed thread | `--reopen`, with or without `-m` |

`-m -` reads the message from standard input, for long or multi-line
replies. `--name NAME` signs your messages (`agent (NAME)`); use it when
several agents work on one branch. `--json` prints the updated thread.
zero prints `replied to thread 1 (resolved)`.

Good replies are short and concrete:

- Say what changed and where: names in `inline code`, `path:line` for
  places. Two sentences are usually enough.
- Do not restate the request or apologize. If you did something other than
  what was asked, say what and why.
- One thread, one reply. Do not resolve a thread you did not address.
- Reply after the change is in the working tree, so the user can check it in
  the same review.
- Messages are Markdown, up to 16 KiB.

When the user answers your question, the thread awaits you again: run
`zero feedback show` once more after a round of replies.

## 3. Raise something yourself

Start a thread when you need the user's decision on code they did not
comment on:

```sh
zero feedback comment fb-3k2q8m --path code/main.go --lines 12-20 -m "This retries forever when the server is down. Cap it at three attempts?"
```

- `--path` is project-relative with forward slashes; `--lines 12-20` or
  `--lines 12` count lines of the working tree's file. Omit `--lines` to
  comment on the whole file.
- Without an id, the thread goes to the current branch's feedback
  (`--project DIR` to choose the repository).
- zero prints `started thread 5 at code/main.go:12-20`.

Keep these rare: the user asked for changes, not a second review.

## 4. Errors and limits

- Exit 1 lists every problem as `field: message` on standard error, for
  example an unknown thread number or lines past the file's end. Fix them
  and run again.
- Limits: 16 KiB per message, 100 messages per thread, 500 threads per
  feedback.

## 5. Without the CLI

If `zero feedback` is an unknown command (an older zero) and you know a
running server's URL, use HTTP:

```sh
curl -q -sS "$ZERO/api/feedback?project=$PROJECT&id=fb-3k2q8m"
curl -q -sS -X POST -H 'Content-Type: application/json' \
  --data '{"project": "/home/user/markdown", "id": "fb-3k2q8m", "thread": 1, "body": "Moved the greeting to a constant.", "status": "resolved", "author": "agent"}' \
  "$ZERO/api/feedback-messages"
```

`-q` skips `~/.curlrc`. `GET /api/feedback` returns the same JSON as
`--json` (every thread; filter on `awaiting: "agent"`). `POST
/api/feedback-messages` takes `{project, id, thread, body, status, author,
name}`; leave out `status` to ask a question. `POST /api/feedback-threads`
starts a thread: `{project, id, path, lines: [start, end], body, author:
"agent"}`. Always send `"author": "agent"`; over HTTP the author defaults to
the user. A 400 lists every problem.
