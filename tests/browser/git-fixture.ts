import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { crc32, deflateSync } from "node:zlib"

// gitFixtureRoot is a throwaway repository with one change of every kind,
// rebuilt before each run. Without git, it is a plain folder and the Source
// Control specs skip. Each run gets its own folder, through the environment so
// the runner, its workers, and the server command agree, so concurrent runs from
// other worktrees cannot rebuild it mid-run. mise run dev rebuilds it in .dev.
function fixtureRoot(): string {
  const existing = process.env.ZERO_BROWSER_GIT_ROOT
  if (existing) return existing
  const created = mkdtempSync(path.join(tmpdir(), "zero-browser-git-"))
  process.env.ZERO_BROWSER_GIT_ROOT = created
  return created
}

export const gitFixtureRoot = fixtureRoot()

// gitFixtureBaseWorktree is a linked worktree of the fixture with main, the
// base branch, checked out. It lives beside the served root; zero opens a
// linked worktree whose repository lies in a root.
export const gitFixtureBaseWorktree = `${gitFixtureRoot}-main`

export const gitFixtureChanges = 8

// Correctness needs separated hunks and collapsed gaps. Extended runs retain
// the ~1.6 MB stress fixture with 1,200 changed lines.
function largeText(changed: boolean): string {
  const lines = Array.from({ length: process.env.ZERO_BROWSER_EXTENDED === "1" ? 24_000 : 400 }, (_, index) => {
    const fox = changed && index % 20 === 0 ? "slow" : "quick"
    return `Line ${index}: the ${fox} brown fox jumps over the lazy dog, step ${index}.`
  })
  return `${lines.join("\n")}\n`
}

// png encodes an RGB image whose pixel(x, y) returns its color.
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3)
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "latin1"), data])
    const check = Buffer.alloc(4)
    check.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
}

// The images branch, off main and outside the stack, changes a diagram and
// adds a badge for image diffs (decision 0116).
export const imagesBranch = "images"
export const diagramBefore = { width: 240, height: 160 }
export const diagramAfter = { width: 320, height: 160 }
export const badgeSize = { width: 64, height: 64 }
const slate: [number, number, number] = [228, 229, 232]
const diagramV1 = png(diagramBefore.width, diagramBefore.height, (x, y) => x > 40 && x < 140 && y > 40 && y < 120 ? [50, 93, 200] : slate)
const diagramV2 = png(diagramAfter.width, diagramAfter.height, (x, y) =>
  (x - 220) ** 2 + (y - 80) ** 2 < 50 ** 2 ? [242, 80, 46] : x > 60 && x < 160 && y > 40 && y < 120 ? [50, 93, 200] : slate)
const badge = png(badgeSize.width, badgeSize.height, (x, y) => (x + y) % 16 < 8 ? [29, 122, 67] : [250, 250, 250])

const committed: Record<string, string | Buffer> = {
  "README.md": "# Fixture\n\nOne\nTwo\nThree\n",
  "src/app.ts": "export const answer = 1\n\nexport function run() {\n  return answer\n}\n",
  "notes/removed.md": "# Removed\n\nThis note goes away.\n",
  "guides/intro.md": "# Intro\n\nRenamed without edits so git pairs it by content.\n",
  "assets/logo.bin": "\u0000\u0001\u0002 logo v1",
  "clean.md": "# Clean\n",
  "large.txt": largeText(false),
  ".gitignore": "*.log\n",
  "assets/diagram.png": diagramV1,
}

// The feature branch is the middle of a stack on main: lowerBranch below it,
// HEAD on feature, and upperBranch on top. Each layer adds one commit.
export const lowerBranch = "docs-base"
export const lowerSubject = "docs: add the guide index"
const lowerCommit: Record<string, string> = {
  "docs/index.md": "# Index\n\nWritten on the lower layer.\n",
}

export const upperBranch = "docs-followup"
export const upperSubject = "docs: add a changelog"
const upperCommit: Record<string, string> = {
  "docs/changelog.md": "# Changelog\n\nWritten on the upper layer.\n",
}

// featureCommit is the feature branch's one commit; the working tree keeps it.
const featureCommit: Record<string, string> = {
  "docs/history.md": "# History\n\nWritten on the feature branch.\n",
  "clean.md": "# Clean\n\nEdited on the feature branch.\n",
}

export const featureSubject = "docs: add history notes"
const featureMessage = `${featureSubject}\n\nExplain how the fixture's branch history is built.\n\nThe feature branch adds one commit on top of ${lowerBranch}.`

const working: Record<string, string | Buffer> = {
  "README.md": "# Fixture\n\nOne\nTwo, changed\nThree\nFour\n",
  "src/app.ts": "export const answer = 2\n\nexport function run() {\n    return answer\n}\n",
  "guides/start.md": committed["guides/intro.md"] ?? "",
  "assets/logo.bin": "\u0000\u0001\u0002 logo v2, larger",
  "added.md": "# Added\n\nStaged, never committed.\n",
  "untracked.txt": "Not yet added.\n",
  "large.txt": largeText(true),
  "debug.log": "ignored\n",
}

function write(files: Record<string, string | Buffer>) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(gitFixtureRoot, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
}

// Git hooks and `git bisect run` export GIT_DIR and friends, which would aim
// these commands at zero's own repository instead of the fixture.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))

function git(...args: string[]): boolean {
  const result = spawnSync("git", ["-c", "user.name=zero", "-c", "user.email=zero@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd: gitFixtureRoot,
    env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdio: "ignore",
  })
  return result.status === 0
}

// commitOn creates branch at HEAD, switches to it, and commits files.
function commitOn(branch: string, files: Record<string, string | Buffer>, message: string) {
  git("switch", "--quiet", "--create", branch)
  write(files)
  git("add", "--all")
  git("commit", "--quiet", "--message", message)
}

export function createGitFixture() {
  rmSync(gitFixtureRoot, { recursive: true, force: true })
  rmSync(gitFixtureBaseWorktree, { recursive: true, force: true })
  mkdirSync(gitFixtureRoot, { recursive: true })
  write(committed)
  if (!git("init", "--quiet", "--initial-branch=main")) {
    rmSync(path.join(gitFixtureRoot, ".git"), { recursive: true, force: true })
    return
  }
  git("add", "--all")
  git("commit", "--quiet", "--message", "Initial")
  // A second base for the branch compare's base picker.
  git("branch", "release")
  commitOn(imagesBranch, { "assets/diagram.png": diagramV2, "assets/badge.png": badge }, "assets: redraw the diagram, add a badge")
  git("switch", "--quiet", "main")
  // A branch stack, so Commits has a branch range against main and Branches
  // has layers below and above HEAD.
  commitOn(lowerBranch, lowerCommit, lowerSubject)
  commitOn("feature", featureCommit, featureMessage)
  commitOn(upperBranch, upperCommit, upperSubject)
  git("switch", "--quiet", "feature")
  // HEAD is the base branch in this worktree.
  git("worktree", "add", "--quiet", gitFixtureBaseWorktree, "main")
  rmSync(path.join(gitFixtureRoot, "notes/removed.md"))
  rmSync(path.join(gitFixtureRoot, "guides/intro.md"))
  write(working)
  git("add", "added.md")
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) createGitFixture()
