import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { crc32 } from 'node:zlib'

// The install scripts (decisions 0073, 0079, 0134) run under /bin/sh with a
// fake HOME and stub uname, curl, wget, go, ditto, xdg-mime,
// update-desktop-database, pgrep, git, mise, jq, and docker first on PATH.
// Stubs log their arguments to STUB_LOG.

const repositoryRoot = process.cwd()
const scriptsDir = join(repositoryRoot, 'scripts')
const SYSTEM_PATH = '/usr/bin:/bin'

interface Sandbox {
  root: string
  home: string
  stubs: string
  log: string
  env: Record<string, string>
}

interface Result {
  code: number
  stdout: string
  stderr: string
}

const STUBS: Record<string, string[]> = {
  uname: [
    'case "$1" in',
    '  -s) echo "$STUB_UNAME_S" ;;',
    '  -m) echo "$STUB_UNAME_M" ;;',
    'esac',
  ],
  go: [
    'echo "go $*" >> "$STUB_LOG"',
    'if [ "$1" = env ]; then',
    '  case "$2" in',
    '    GOBIN) echo "" ;;',
    '    GOPATH) echo "$HOME/go" ;;',
    '  esac',
    'fi',
  ],
  // macOS only: extracts a release zip as zero-desktop.app, or copies a
  // directory.
  ditto: [
    'echo "ditto $*" >> "$STUB_LOG"',
    'if [ "$1" = -x ]; then',
    '  /usr/bin/unzip -q "$3" -d "$4"',
    'else',
    '  cp -R "$1" "$2"',
    'fi',
  ],
  'xdg-mime': ['echo "xdg-mime $*" >> "$STUB_LOG"'],
  'update-desktop-database': ['echo "update-desktop-database $*" >> "$STUB_LOG"'],
  pgrep: ['exit "${STUB_PGREP:-1}"'],
  ldconfig: ['echo "${STUB_LDCONFIG:-}"'],
  // Serves STUB_RELEASE_DIR/<last URL segment>; -w answers the latest redirect.
  curl: [
    'echo "curl $*" >> "$STUB_LOG"',
    'out=""; write=""; url=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) out="$2"; shift ;;',
    '    -w) write="$2"; shift ;;',
    '    --retry | --connect-timeout) shift ;;',
    '    -*) ;;',
    '    *) url="$1" ;;',
    '  esac',
    '  shift',
    'done',
    'if [ -n "$write" ]; then printf "%s" "$STUB_LATEST"; exit 0; fi',
    'case " ${STUB_CURL_MISSING:-} " in *" $url "*) exit 22 ;; esac',
    'file="$STUB_RELEASE_DIR/${url##*/}"',
    '[ -f "$file" ] || exit 22',
    'if [ -z "$out" ]; then cat "$file"; else cp "$file" "$out"; fi',
  ],
  wget: [
    'echo "wget $*" >> "$STUB_LOG"',
    'out=""; url=""; headers=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -O) out="$2"; shift ;;',
    '    -S) headers=1 ;;',
    '    -*) ;;',
    '    *) url="$1" ;;',
    '  esac',
    '  shift',
    'done',
    'if [ -n "$headers" ]; then',
    '  echo "  HTTP/1.1 302 Found" >&2',
    '  echo "  Location: $STUB_LATEST" >&2',
    '  exit 8',
    'fi',
    'file="$STUB_RELEASE_DIR/${url##*/}"',
    '[ -f "$file" ] || exit 8',
    'if [ "$out" = - ]; then cat "$file"; else cp "$file" "$out"; fi',
  ],
  // origin has the branches in STUB_BRANCHES at STUB_SHA; STUB_FORK_SHA is a
  // commit GitHub serves that is on none of them. clone writes a mise.toml
  // with a dist task unless STUB_NO_DIST.
  git: [
    'echo "git $*" >> "$STUB_LOG"',
    'if [ "$1" = -C ]; then shift 2; fi',
    'if [ "$1" = -c ]; then shift 2; fi',
    'for last; do :; done',
    'case "$1" in',
    '  clone)',
    '    mkdir -p "$last"',
    '    if [ -z "${STUB_NO_DIST:-}" ]; then printf "[tasks.dist]\\n" > "$last/mise.toml"; else : > "$last/mise.toml"; fi ;;',
    '  show-ref)',
    '    case " ${STUB_BRANCHES:-main} " in *" ${last#refs/remotes/origin/} "*) exit 0 ;; esac',
    '    exit 1 ;;',
    '  rev-parse)',
    '    ref="$(printf "%s" "$last" | sed "s/\\^{commit}\\$//")"',
    '    case "$ref" in refs/remotes/origin/*) echo "$STUB_SHA"; exit 0 ;; esac',
    '    case "$STUB_SHA" in "$ref"*) echo "$STUB_SHA"; exit 0 ;; esac',
    '    case "$STUB_FORK_SHA" in "$ref"*) echo "$STUB_FORK_SHA"; exit 0 ;; esac',
    '    exit 1 ;;',
    '  for-each-ref)',
    '    if [ "$3" = "$STUB_SHA" ]; then echo "$STUB_SHA commit refs/remotes/origin/main"; fi ;;',
    'esac',
  ],
  // run dist copies STUB_RELEASE_DIR assets for ZERO_DIST_VERSION into
  // ZERO_DIST_OUT, as the ref's real task builds them.
  mise: [
    'echo "mise $* version=${ZERO_DIST_VERSION:-} trusted=${MISE_TRUSTED_CONFIG_PATHS:-} pwd=$(pwd)" >> "$STUB_LOG"',
    'if [ "$1 $2" = "run dist" ]; then',
    '  [ -z "${STUB_DIST_FAIL:-}" ] || exit 1',
    '  mkdir -p "$ZERO_DIST_OUT"',
    '  for file in "$STUB_RELEASE_DIR/zero_${ZERO_DIST_VERSION}_"* "$STUB_RELEASE_DIR/zero-desktop_${ZERO_DIST_VERSION}_"*; do',
    '    if [ -f "$file" ]; then cp "$file" "$ZERO_DIST_OUT/"; fi',
    '  done',
    'fi',
  ],
  jq: ['exit 0'],
  // Not running unless STUB_DOCKER=0; image ls prints STUB_DOCKER_IMAGES.
  docker: [
    'echo "docker $*" >> "$STUB_LOG"',
    'if [ "$1 $2" = "image ls" ]; then printf "%s" "${STUB_DOCKER_IMAGES:-}"; exit 0; fi',
    'exit "${STUB_DOCKER:-1}"',
  ],
}

const SHA = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b'
const FORK_SHA = 'f0e1d2c3b4a5968778695a4b3c2d1e0f0e1d2c3b'

function fakeZero(version: string): string {
  return [
    '#!/bin/sh',
    'case "$1" in',
    `  --version) echo "zero ${version}" ;;`,
    '  daemon) exit "${STUB_DAEMON_STATUS:-1}" ;;',
    'esac',
    '',
  ].join('\n')
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  await chmod(path, 0o755)
}

async function createSandbox(
  registerCleanup: (cleanup: () => Promise<void>) => void,
  options: { homeName?: string; without?: string[] } = {},
): Promise<Sandbox> {
  const testRoot = join(repositoryRoot, '.scratch', 'test-tmp')
  await mkdir(testRoot, { recursive: true })
  const root = await mkdtemp(join(testRoot, 'zero-install-'))
  registerCleanup(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const home = join(root, options.homeName ?? 'home')
  const stubs = join(root, 'stubs')
  await mkdir(home, { recursive: true })
  for (const [name, lines] of Object.entries(STUBS)) {
    if (options.without?.includes(name) === true) continue
    await writeExecutable(join(stubs, name), ['#!/bin/sh', ...lines, ''].join('\n'))
  }
  const log = join(root, 'stub.log')
  await writeFile(log, '')
  return {
    root,
    home,
    stubs,
    log,
    env: {
      HOME: home,
      PATH: `${stubs}:${join(home, '.local', 'bin')}:${SYSTEM_PATH}`,
      SHELL: '/bin/bash',
      STUB_LOG: log,
      STUB_UNAME_S: 'Linux',
      STUB_UNAME_M: 'x86_64',
      STUB_RELEASE_DIR: join(root, 'release'),
      STUB_LATEST: 'https://github.com/flexdinesh/zero/releases/tag/v0.1.7',
      STUB_SHA: SHA,
      STUB_FORK_SHA: FORK_SHA,
    },
  }
}

// createRelease writes a release's assets for <os>/<arch> (linux/amd64 by
// default), named for version (0.1.7 by default; install-dev.sh builds
// 0.0.0-dev.<branch>): the CLI archive.
async function createRelease(
  sandbox: Sandbox,
  options: { arch?: string; os?: string; version?: string } = {},
): Promise<void> {
  const arch = options.arch ?? 'amd64'
  const os = options.os ?? 'linux'
  const version = options.version ?? '0.1.7'
  const release = sandbox.env.STUB_RELEASE_DIR ?? ''
  const name = `zero_${version}_${os}_${arch}`
  await writeExecutable(join(release, name, 'zero'), fakeZero(`${version} (abc123)`))
  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['-czf', join(release, `${name}.tar.gz`), '-C', release, name], (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
  await rm(join(release, name), { recursive: true })
}

// Minimal stored ZIP writer, including Unix modes. Tests validate real ZIPs
// with the same unzip integrity/member checks used by the macOS installer.
function zipFiles(files: { name: string; content: string; mode?: number }[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = Buffer.from(file.content)
    const checksum = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(0x0314, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(checksum, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(((file.mode ?? 0o100755) * 65536) >>> 0, 38)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

// createDesktopRelease writes the desktop app's assets for version: the Linux
// archive for arch (the app, its bundled zero, and its icon) and the
// darwin/arm64 zip.
async function createDesktopRelease(sandbox: Sandbox, options: { arch?: string; version?: string } = {}): Promise<void> {
  const arch = options.arch ?? 'amd64'
  const version = options.version ?? '0.1.7'
  const release = sandbox.env.STUB_RELEASE_DIR ?? ''
  const staging = join(release, 'desktop-staging')
  await writeExecutable(join(staging, 'zero-desktop'), `#!/bin/sh\necho "zero-desktop ${version} abc123"\n`)
  await writeExecutable(join(staging, 'bin', 'zero'), fakeZero(`${version} (abc123)`))
  await writeFile(join(staging, 'zero-desktop.png'), 'desktop png')
  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['-czf', join(release, `zero-desktop_${version}_linux_${arch}.tar.gz`), '-C', staging, '.'], (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
  await rm(staging, { recursive: true })
  await writeFile(join(release, `zero-desktop_${version}_darwin_arm64.zip`), zipFiles([
    { name: 'zero-desktop.app/Contents/MacOS/zero-desktop', content: '#!/bin/sh\nexit 1\n' },
    { name: 'zero-desktop.app/Contents/Resources/bin/zero', content: fakeZero(version) },
  ]))
}

// createFullRelease writes everything a default install downloads on Linux.
async function createFullRelease(sandbox: Sandbox, options: { arch?: string; version?: string } = {}): Promise<void> {
  await createRelease(sandbox, options)
  await createDesktopRelease(sandbox, options)
}

function run(script: string, sandbox: Sandbox, env: Record<string, string> = {}, args: string[] = []): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [join(scriptsDir, script), ...args], {
      env: { ...sandbox.env, ...env },
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => { resolve({ code: code ?? 1, stdout, stderr }) })
    child.stdin.end()
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isExecutable(path: string): Promise<boolean> {
  return ((await stat(path)).mode & 0o111) !== 0
}

function assertOk(result: Result): void {
  assert.equal(result.code, 0, `exit ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
}

// --- shared blocks ---

void test('shared blocks are identical in every script that carries them', async () => {
  const scripts = (await readdir(scriptsDir)).filter((name) => name.endsWith('.sh'))
  assert.ok(scripts.length >= 3)
  const blocks = new Map<string, Map<string, string>>()
  for (const script of scripts) {
    const text = await readFile(join(scriptsDir, script), 'utf8')
    const begins = [...text.matchAll(/^# shared:([a-z-]+):begin$/gm)].map((match) => match[1])
    const ends = [...text.matchAll(/^# shared:([a-z-]+):end$/gm)].map((match) => match[1])
    assert.deepEqual(ends, begins, `${script}: unbalanced shared markers`)
    assert.ok(begins.includes('base'), `${script} lacks the base block`)
    for (const match of text.matchAll(/^# shared:([a-z-]+):begin\n([\s\S]*?)^# shared:\1:end$/gm)) {
      const name = match[1] ?? ''
      const copies = blocks.get(name) ?? new Map<string, string>()
      copies.set(script, match[2] ?? '')
      blocks.set(name, copies)
    }
  }
  for (const [name, copies] of blocks) {
    const [first, ...rest] = [...copies]
    if (first === undefined) continue
    for (const [script, body] of rest) {
      assert.equal(body, first[1], `shared:${name} in ${script} differs from ${first[0]}`)
    }
  }
})

const CHANNELS = [
  { script: 'install.sh', version: '0.1.7', cliOnly: true },
  { script: 'install-dev.sh', version: '0.0.0-dev.main', cliOnly: false },
]
const CLI_ONLY = ['--cli-only']
const cliPath = (sandbox: Sandbox, name = 'zero') => join(sandbox.home, '.local', 'bin', name)
const recordPath = (sandbox: Sandbox) => join(sandbox.home, '.config', 'zero', 'install.tsv')

async function entryExists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch { return false }
}

// util-linux script creates a real controlling PTY. The installer is delivered
// by curl | sh, so confirmation must read /dev/tty instead of script stdin.
async function runPipedPTY(sandbox: Sandbox, script: string, answer: string, args: string[] = []): Promise<Result> {
  await mkdir(sandbox.env.STUB_RELEASE_DIR ?? '', { recursive: true })
  await writeFile(join(sandbox.env.STUB_RELEASE_DIR ?? '', 'installer'), await readFile(join(scriptsDir, script)))
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/script', ['-q', '-e', '-c', `curl https://fixture/installer | sh -s -- ${args.join(' ')}`, '/dev/null'], {
      env: sandbox.env,
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let answered = false
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`PTY timeout: ${stdout}\n${stderr}`)) }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (!answered && stdout.includes('[y/N]')) {
        answered = true
        child.stdin.write(answer)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

for (const { script, version, cliOnly } of CHANNELS) {
  void test(`${script}: installs both components, records ownership, keeps canonical identity`, async (t) => {
    const sandbox = await createSandbox(t.after.bind(t), { homeName: 'home 50%' })
    await createFullRelease(sandbox, { version })
    const state = join(sandbox.home, '.local/share/zero-desktop/localstorage/page.localstorage')
    await writeExecutable(state, 'tabs')
    assertOk(await run(script, sandbox, {}, ['--name', 'my-zero']))
    const app = join(sandbox.home, '.local/share/zero-desktop/app')
    assert.ok(await isExecutable(cliPath(sandbox, 'my-zero')))
    assert.equal(await exists(cliPath(sandbox)), false)
    assert.ok(await isExecutable(join(app, 'bin/zero')))
    assert.equal(await readFile(state, 'utf8'), 'tabs')
    const entry = await readFile(join(sandbox.home, '.local/share/applications/zero-desktop.desktop'), 'utf8')
    assert.match(entry, /^Name=Zero$/m)
    assert.match(entry, /^MimeType=x-scheme-handler\/zero;$/m)
    assert.ok(entry.includes(`Exec="${app.replaceAll('%', '%%')}/zero-desktop" %U`), entry)
    const record = await readFile(recordPath(sandbox), 'utf8')
    assert.match(record, /^zero-install-v1\nname\tmy-zero\n/)
    for (const role of ['cli', 'app', 'link', 'entry', 'icon']) assert.ok(record.includes(`\n${role}\t`), role)
    assert.equal((await stat(recordPath(sandbox))).mode & 0o777, 0o600)
    const output = await run(script, sandbox, {}, cliOnly ? CLI_ONLY : [])
    assertOk(output)
    assert.match(output.stdout, /updated .*my-zero/)
    assert.match(output.stdout, /my-zero \./)
  })

  void test(`${script}: every occupied destination type collides without executing it`, async (t) => {
    for (const type of ['executable', 'file', 'directory', 'symlink', 'dangling']) {
      const sandbox = await createSandbox(t.after.bind(t))
      await createFullRelease(sandbox, { version })
      const target = cliPath(sandbox)
      await mkdir(dirname(target), { recursive: true })
      if (type === 'directory') await mkdir(target)
      else if (type === 'symlink' || type === 'dangling') {
        const referent = join(sandbox.root, 'referent')
        if (type === 'symlink') await writeExecutable(referent, 'exit 1')
        await symlink(referent, target)
      } else {
        await writeFile(target, '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n')
        if (type === 'executable') await chmod(target, 0o755)
      }
      const before = await lstat(target)
      const result = await run(script, sandbox)
      assert.notEqual(result.code, 0, type)
      assert.match(result.stdout, /collision:/)
      assert.ok(result.stderr.includes(`scripts/${script} | sh -s -- --name zero-cli`), result.stderr)
      assert.match(result.stderr, /confirmation requires a terminal/)
      assert.equal((await lstat(target)).ino, before.ino, type)
      assert.equal(await exists(join(sandbox.home, '.local/share')), false)
      assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /EXECUTED|releases\/download/)
    }
  })

  void test(`${script}: detects executable copies anywhere on PATH, including relative and empty entries`, async (t) => {
    for (const position of ['before', 'after', 'relative']) {
      const sandbox = await createSandbox(t.after.bind(t))
      await createFullRelease(sandbox, { version })
      const unrelated = join(sandbox.root, 'other')
      await writeExecutable(join(unrelated, 'zero'), '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n')
      const path = position === 'before'
        ? `${sandbox.stubs}:${unrelated}:${dirname(cliPath(sandbox))}:${SYSTEM_PATH}`
        : position === 'after'
          ? `${sandbox.env.PATH}:${unrelated}`
          : `${sandbox.env.PATH}:${unrelated.slice(repositoryRoot.length + 1)}:`
      const result = await run(script, sandbox, { PATH: path })
      assert.notEqual(result.code, 0)
      assert.match(result.stdout, /other\/zero/)
      assert.equal(await exists(cliPath(sandbox)), false)
      assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /EXECUTED/)
    }
  })

  void test(`${script}: piped PTY accepts only explicit yes; decline and EOF leave both components alone`, async (t) => {
    for (const answer of ['y\n', 'yes\n', 'n\n', '\n', '\x04']) {
      const sandbox = await createSandbox(t.after.bind(t))
      await createFullRelease(sandbox, { version })
      await writeExecutable(cliPath(sandbox), '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n')
      const result = await runPipedPTY(sandbox, script, answer)
      assert.match(result.stdout, /Install as zero-cli instead\? \[y\/N\]/)
      if (answer.startsWith('y')) {
        assertOk(result)
        assert.ok(await isExecutable(cliPath(sandbox, 'zero-cli')))
        assert.match(result.stdout, /zero-cli \./)
      } else {
        assert.notEqual(result.code, 0)
        assert.match(result.stdout, /--name zero-cli/)
        assert.equal(await exists(cliPath(sandbox, 'zero-cli')), false)
        assert.equal(await exists(join(sandbox.home, '.local/share')), false)
      }
      assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /EXECUTED/)
    }
  })

  void test(`${script}: both occupied names stop without prompting; explicit names never overwrite`, async (t) => {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox, { version })
    await writeExecutable(cliPath(sandbox), 'zero stranger')
    await mkdir(cliPath(sandbox, 'zero-cli'))
    const result = await runPipedPTY(sandbox, script, 'y\n')
    assert.notEqual(result.code, 0)
    assert.doesNotMatch(result.stdout, /\[y\/N\]/)
    assert.match(result.stdout, /--name NAME/)
    const explicit = await run(script, sandbox, {}, ['--name', 'zero'])
    assert.notEqual(explicit.code, 0)
    assert.match(explicit.stderr, /explicit name zero is occupied/)
    assert.equal(await readFile(cliPath(sandbox), 'utf8'), 'zero stranger')
    assertOk(await run(script, sandbox, {}, ['--name', 'zero-custom']))
  })

  void test(`${script}: validates custom basenames and options before downloads`, async (t) => {
    const sandbox = await createSandbox(t.after.bind(t))
    const invalid = [['--name'], ['--name', '../zero'], ['--name', '/tmp/zero'], ['--name', '-zero'], ['--name', 'white space'], ['--name', ''], ['--name', 'zero-desktop'], ['--wrong']]
    if (!cliOnly) invalid.push(['--cli-only'], ['--ref'], ['--ref', ''], ['--ref', '-x'], ['--ref', 'HEAD'])
    for (const args of invalid) {
      assert.notEqual((await run(script, sandbox, {}, args)).code, 0, JSON.stringify(args))
    }
    assert.equal(await readFile(sandbox.log, 'utf8'), '')
    assert.deepEqual(await readdir(sandbox.home), [])
  })

  void test(`${script}: desktop destination collisions preflight before either install`, async (t) => {
    for (const relative of ['.local/bin/zero-desktop', '.local/share/zero-desktop/app', '.local/share/applications/zero-desktop.desktop', '.local/share/icons/hicolor/512x512/apps/zero-desktop.png']) {
      const sandbox = await createSandbox(t.after.bind(t))
      await createFullRelease(sandbox, { version })
      const path = join(sandbox.home, relative)
      await writeExecutable(path, 'stranger')
      const result = await run(script, sandbox)
      assert.notEqual(result.code, 0)
      assert.ok(result.stderr.includes(`collision: ${path}`), result.stderr)
      assert.equal(await exists(cliPath(sandbox)), false)
      assert.equal(await readFile(path, 'utf8'), 'stranger')
      assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /releases\/download/)
    }
  })

  if (cliOnly) void test(`${script}: cli-only skips desktop checks and downloads; preserves its record`, async (t) => {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox, { version })
    assertOk(await run(script, sandbox))
    const before = (await readFile(recordPath(sandbox), 'utf8')).split('\n').filter((line) => /^(app|link|entry|icon)\t/.test(line))
    assertOk(await run(script, sandbox, { STUB_PGREP: '0' }, CLI_ONLY))
    const after = (await readFile(recordPath(sandbox), 'utf8')).split('\n').filter((line) => /^(app|link|entry|icon)\t/.test(line))
    assert.deepEqual(after, before)
  })

  void test(`${script}: missing or malformed assets leave existing owned installations unchanged`, async (t) => {
    for (const failure of ['cli-missing', 'desktop-missing', 'cli-corrupt', 'desktop-corrupt', 'desktop-incomplete']) {
      const sandbox = await createSandbox(t.after.bind(t))
      await createFullRelease(sandbox, { version })
      assertOk(await run(script, sandbox))
      const record = await readFile(recordPath(sandbox), 'utf8')
      const cli = await readFile(cliPath(sandbox), 'utf8')
      const release = sandbox.env.STUB_RELEASE_DIR ?? ''
      const cliArchive = join(release, `zero_${version}_linux_amd64.tar.gz`)
      const desktopArchive = join(release, `zero-desktop_${version}_linux_amd64.tar.gz`)
      if (failure === 'cli-missing') await rm(cliArchive)
      else if (failure === 'desktop-missing') await rm(desktopArchive)
      else if (failure === 'cli-corrupt') await writeFile(cliArchive, 'bad')
      else if (failure === 'desktop-corrupt') await writeFile(desktopArchive, 'bad')
      else {
        const empty = join(release, 'empty')
        await mkdir(empty)
        await new Promise<void>((resolve, reject) => {
          execFile('tar', ['-czf', desktopArchive, '-C', empty, '.'], (error) => error === null ? resolve() : reject(error))
        })
      }
      const result = await run(script, sandbox, {}, ['--name', 'new-zero'])
      assert.notEqual(result.code, 0, failure)
      assert.equal(await readFile(recordPath(sandbox), 'utf8'), record)
      assert.equal(await readFile(cliPath(sandbox), 'utf8'), cli)
      assert.equal(await exists(cliPath(sandbox, 'new-zero')), false)
    }
  })
}

void test('updates, name switches, channel switches, and uninstall use recorded fingerprints', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox)
  await createFullRelease(sandbox, { version: '0.0.0-dev.main' })
  assertOk(await run('install.sh', sandbox, {}, ['--name', 'zero-cli']))
  assertOk(await run('install-dev.sh', sandbox))
  assert.match(await readFile(cliPath(sandbox, 'zero-cli'), 'utf8'), /0.0.0-dev.main/)
  assertOk(await run('install.sh', sandbox, {}, ['--name', 'another-zero']))
  assert.equal(await entryExists(cliPath(sandbox, 'zero-cli')), false)
  assert.equal(await exists(cliPath(sandbox)), false)
  assert.match(await readFile(cliPath(sandbox, 'another-zero'), 'utf8'), /0.1.7/)
  const roots = join(sandbox.home, '.config/zero/roots.json')
  await writeFile(roots, '[]')
  const srcz = cliPath(sandbox, 'srcz')
  const stranger = cliPath(sandbox)
  const malicious = '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n'
  await writeExecutable(srcz, malicious)
  await writeExecutable(stranger, malicious)
  await writeExecutable(join(sandbox.home, 'go/bin/zero'), malicious)
  const result = await run('uninstall.sh', sandbox)
  assertOk(result)
  assert.equal(await exists(cliPath(sandbox, 'another-zero')), false)
  assert.equal(await exists(join(sandbox.home, '.local/share/zero-desktop/app')), false)
  assert.equal(await entryExists(cliPath(sandbox, 'zero-desktop')), false)
  assert.equal(await exists(recordPath(sandbox)), false)
  for (const path of [srcz, stranger, join(sandbox.home, 'go/bin/zero')]) assert.equal(await readFile(path, 'utf8'), malicious)
  assert.equal(await readFile(roots, 'utf8'), '[]')
  assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /EXECUTED/)
})

void test('modified CLI and app are preserved on update and uninstall; name switch leaves modified old command', async (t) => {
  for (const modified of ['cli', 'app', 'link', 'entry', 'icon']) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox)
    assertOk(await run('install.sh', sandbox))
    const app = join(sandbox.home, '.local/share/zero-desktop/app')
    const path = modified === 'cli' ? cliPath(sandbox)
      : modified === 'app' ? join(app, 'bin/zero')
        : modified === 'entry' ? join(sandbox.home, '.local/share/applications/zero-desktop.desktop')
          : modified === 'icon' ? join(sandbox.home, '.local/share/icons/hicolor/512x512/apps/zero-desktop.png')
            : cliPath(sandbox, 'zero-desktop')
    if (modified === 'link') { await rm(path); await symlink('/unrelated', path) }
    else await writeExecutable(path, '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n')
    const update = await run('install.sh', sandbox)
    assert.notEqual(update.code, 0, modified)
    assert.match(update.stdout + update.stderr, /collision:/)
    if (modified === 'cli') {
      const rename = await run('install.sh', sandbox, {}, ['--name', 'zero-other'])
      assertOk(rename)
      assert.match(rename.stdout, /kept .*zero: ownership changed/)
    }
    const result = await run('uninstall.sh', sandbox)
    assertOk(result)
    assert.ok(await entryExists(path), modified)
    assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /EXECUTED/)
  }
})

void test('ownership record is parsed only as data; symlink records rejected', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox)
  await mkdir(dirname(recordPath(sandbox)), { recursive: true })
  await writeFile(recordPath(sandbox), 'touch "$HOME/EXECUTED"\n')
  assert.notEqual((await run('install.sh', sandbox)).code, 0)
  assert.notEqual((await run('uninstall.sh', sandbox)).code, 0)
  assert.equal(await exists(join(sandbox.home, 'EXECUTED')), false)
  await rm(recordPath(sandbox))
  await symlink(join(sandbox.root, 'absent'), recordPath(sandbox))
  assert.notEqual((await run('install.sh', sandbox)).code, 0)
  assert.equal(await exists(cliPath(sandbox)), false)
})

void test('unmanaged zero and srcz installations are neither executed nor deleted', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  for (const name of ['zero', 'srcz', 'zero-desktop']) await writeExecutable(cliPath(sandbox, name), '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n')
  const app = join(sandbox.home, '.local/share/zero-desktop/app/bin/zero')
  await writeExecutable(app, '#!/bin/sh\necho EXECUTED >> "$STUB_LOG"\n')
  const result = await run('uninstall.sh', sandbox)
  assertOk(result)
  assert.match(result.stdout, /nothing to remove/)
  for (const name of ['zero', 'srcz', 'zero-desktop']) assert.ok(await exists(cliPath(sandbox, name)))
  assert.ok(await exists(app))
  assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /EXECUTED/)
})

void test('running managed daemon or desktop stops uninstall; cli-only still updates', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox)
  assertOk(await run('install.sh', sandbox))
  const daemon = await run('uninstall.sh', sandbox, { STUB_DAEMON_STATUS: '0' })
  assert.notEqual(daemon.code, 0)
  assert.match(daemon.stderr, /zero daemon stop/)
  const desktop = await run('uninstall.sh', sandbox, { STUB_PGREP: '0' })
  assert.notEqual(desktop.code, 0)
  assert.match(desktop.stderr, /desktop app is running/)
  const install = await run('install.sh', sandbox, { STUB_PGREP: '0' })
  assert.notEqual(install.code, 0)
  assertOk(await run('install.sh', sandbox, { STUB_PGREP: '0' }, CLI_ONLY))
})

void test('bin-directory preference and shell PATH instructions survive collision safety', async (t) => {
  for (const shell of ['fish', 'zsh', 'bash', 'dash']) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createRelease(sandbox)
    const result = await run('install.sh', sandbox, { PATH: `${sandbox.stubs}:${SYSTEM_PATH}`, SHELL: `/bin/${shell}` }, CLI_ONLY)
    assertOk(result)
    assert.equal(result.stdout.match(/not on PATH/g)?.length, 1)
    assert.match(result.stdout, shell === 'fish' ? /fish_add_path/ : /export PATH=/)
    assert.deepEqual((await readdir(sandbox.home)).sort(), ['.config', '.local'])
  }
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox)
  assertOk(await run('install.sh', sandbox, { PATH: `${sandbox.stubs}:${join(sandbox.home, 'bin')}:${SYSTEM_PATH}` }))
  assert.ok(await exists(join(sandbox.home, 'bin/zero')))
  assert.ok(await entryExists(join(sandbox.home, 'bin/zero-desktop')))
})

void test('platform support and missing latest release fail without installing', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  const unsupported: Record<string, string>[] = [{ STUB_UNAME_S: 'Windows' }, { STUB_UNAME_M: 'i686' }, { STUB_UNAME_S: 'Darwin', STUB_UNAME_M: 'x86_64' }]
  for (const env of unsupported) {
    assert.notEqual((await run('install-dev.sh', sandbox, env)).code, 0)
  }
  const result = await run('install.sh', sandbox, { STUB_LATEST: '' })
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /could not find the latest zero release/)
  assert.deepEqual(await readdir(sandbox.home), [])
})

void test('macOS uses canonical config and application identity with alternate CLI naming', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createRelease(sandbox, { os: 'darwin', arch: 'arm64' })
  await createDesktopRelease(sandbox)
  const apps = (await exists('/Applications')) ? '/Applications' : join(sandbox.home, 'Applications')
  t.after(async () => { if (apps === '/Applications') await rm(join(apps, 'zero-desktop.app'), { recursive: true, force: true }) })
  const env = { STUB_UNAME_S: 'Darwin', STUB_UNAME_M: 'arm64' }
  assertOk(await run('install.sh', sandbox, env, ['--name', 'zero-cli']))
  const record = join(sandbox.home, 'Library/Application Support/zero/install.tsv')
  assert.match(await readFile(record, 'utf8'), /name\tzero-cli/)
  assert.ok(await exists(join(apps, 'zero-desktop.app/Contents/Resources/bin/zero')))
  assertOk(await run('uninstall.sh', sandbox, env))
  assert.equal(await exists(join(apps, 'zero-desktop.app')), false)
})

void test('PATH nonexecutables are ignored; unmanaged byte-identical executable copies still collide', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createRelease(sandbox)
  const other = join(sandbox.root, 'other')
  await mkdir(other)
  await writeFile(join(other, 'zero'), 'not executable')
  const env = { PATH: `${sandbox.env.PATH}:${other}` }
  assertOk(await run('install.sh', sandbox, env, CLI_ONLY))
  await writeExecutable(join(other, 'zero'), await readFile(cliPath(sandbox), 'utf8'))
  const result = await run('install.sh', sandbox, env, CLI_ONLY)
  assert.notEqual(result.code, 0)
  assert.match(result.stdout, /other\/zero/)
})

void test('absolute/relative XDG paths and shared data/config preserve user state', async (t) => {
  for (const absolute of [true, false]) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox)
    const xdg = join(sandbox.root, 'xdg')
    const env = { XDG_DATA_HOME: absolute ? xdg : 'relative', XDG_CONFIG_HOME: absolute ? xdg : 'relative' }
    const config = absolute ? join(xdg, 'zero') : join(sandbox.home, '.config/zero')
    const data = absolute ? xdg : join(sandbox.home, '.local/share')
    const state = join(data, 'zero-desktop/localstorage/page.localstorage')
    await writeExecutable(state, 'tabs')
    assertOk(await run('install.sh', sandbox, env))
    assert.ok(await exists(join(config, 'install.tsv')))
    assertOk(await run('uninstall.sh', sandbox, env))
    assert.equal(await readFile(state, 'utf8'), 'tabs')
  }
})

void test('symlinked bin-directory aliases still identify the same managed installation', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createRelease(sandbox)
  const real = join(sandbox.root, 'actual-bin')
  await mkdir(real)
  await mkdir(dirname(cliPath(sandbox)), { recursive: true })
  await rm(dirname(cliPath(sandbox)), { recursive: true })
  await symlink(real, dirname(cliPath(sandbox)))
  assertOk(await run('install.sh', sandbox, {}, CLI_ONLY))
  assertOk(await run('install.sh', sandbox, {}, CLI_ONLY))
  assertOk(await run('uninstall.sh', sandbox))
  assert.equal(await exists(join(real, 'zero')), false)
})

void test('configuration collisions fail before installation destinations change', async (t) => {
  for (const kind of ['file', 'symlink']) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox)
    const config = dirname(recordPath(sandbox))
    await mkdir(dirname(config), { recursive: true })
    if (kind === 'file') await writeFile(config, 'unrelated')
    else await symlink(join(sandbox.root, 'elsewhere'), config)
    assert.notEqual((await run('install.sh', sandbox)).code, 0)
    assert.equal(await exists(cliPath(sandbox)), false)
    assert.equal(await exists(join(sandbox.home, '.local/share')), false)
  }
})

void test('uninstall checks a verified bundled daemon when the exposed CLI is missing', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox)
  assertOk(await run('install.sh', sandbox))
  await rm(cliPath(sandbox))
  const result = await run('uninstall.sh', sandbox, { STUB_DAEMON_STATUS: '0' })
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /app\/bin\/zero daemon stop/)
  assert.ok(await exists(recordPath(sandbox)))
})

void test('unsafe tar and ZIP members fail before installing either component', async (t) => {
  for (const format of ['tar-link', 'tar-parent', 'zip-link', 'zip-parent']) {
    const sandbox = await createSandbox(t.after.bind(t))
    const darwin = format.startsWith('zip')
    await createRelease(sandbox, darwin ? { os: 'darwin', arch: 'arm64' } : {})
    await createDesktopRelease(sandbox)
    const release = sandbox.env.STUB_RELEASE_DIR ?? ''
    if (darwin) {
      await writeFile(join(release, 'zero-desktop_0.1.7_darwin_arm64.zip'), zipFiles([
        { name: format === 'zip-parent' ? '../escaped' : 'link', content: '/tmp', mode: format === 'zip-link' ? 0o120777 : 0o100755 },
      ]))
    } else {
      const staging = join(release, 'unsafe')
      await mkdir(staging)
      await writeFile(join(staging, 'file'), 'unrelated')
      await symlink('/tmp', join(staging, 'link'))
      const args = format === 'tar-link' ? ['link'] : ['--transform=s,file,../escaped,', 'file']
      await new Promise<void>((resolve, reject) => {
        execFile('tar', ['-czf', join(release, 'zero-desktop_0.1.7_linux_amd64.tar.gz'), '-C', staging, ...args], (error) => error === null ? resolve() : reject(error))
      })
    }
    const result = await run('install.sh', sandbox, darwin ? { STUB_UNAME_S: 'Darwin', STUB_UNAME_M: 'arm64' } : {})
    assert.notEqual(result.code, 0, format)
    assert.match(result.stderr, /unsafe archive/, format)
    assert.equal(await exists(cliPath(sandbox)), false)
    assert.equal(await exists(recordPath(sandbox)), false)
    assert.equal(await exists(join(sandbox.home, '.local/share')), false)
  }
})

// --- install-dev.sh (decision 0134) ---

// pathWithout links every system executable except names into a directory, so
// a tool on the host's /usr/bin still counts as missing.
async function pathWithout(sandbox: Sandbox, names: string[]): Promise<string> {
  const bin = join(sandbox.root, 'system')
  await mkdir(bin, { recursive: true })
  for (const dir of SYSTEM_PATH.split(':')) {
    for (const name of await readdir(dir)) {
      if (names.includes(name) || await entryExists(join(bin, name))) continue
      await symlink(join(dir, name), join(bin, name))
    }
  }
  return `${sandbox.stubs}:${bin}`
}

void test('install-dev.sh: builds main by default with the ref\'s own dist task, trusting only the clone', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox, { version: '0.0.0-dev.main' })
  const result = await run('install-dev.sh', sandbox)
  assertOk(result)
  assert.match(await readFile(cliPath(sandbox), 'utf8'), /0.0.0-dev.main/)
  const log = await readFile(sandbox.log, 'utf8')
  assert.match(log, /^git clone --quiet --filter=blob:none --no-checkout https:\/\/github\.com\/flexdinesh\/zero\.git /m)
  assert.ok(log.includes(`checkout --quiet --detach ${SHA}`), log)
  assert.match(log, /^mise install version=0\.0\.0-dev\.main trusted=\S+\/src pwd=\S+\/src$/m)
  assert.match(log, /^mise run dist version=0\.0\.0-dev\.main trusted=\S+\/src pwd=\S+\/src$/m)
  assert.doesNotMatch(log, /dist:image|releases\/download/)
  assert.match(result.stdout, /Docker is not running, so no zero-dev:0\.0\.0-dev\.main image/)
})

void test('install-dev.sh: branches become version slugs; commits on origin branches use g<sha12>', async (t) => {
  const cases = [
    { ref: 'feat/x-1', branch: true, version: '0.0.0-dev.feat-x-1' },
    { ref: 'Fix__Weird//name-', branch: true, version: '0.0.0-dev.Fix-Weird-name' },
    { ref: '0123', branch: true, version: '0.0.0-dev.b-0123' },
    { ref: SHA.slice(0, 7).toUpperCase(), branch: false, version: `0.0.0-dev.g${SHA.slice(0, 12)}` },
    { ref: SHA, branch: false, version: `0.0.0-dev.g${SHA.slice(0, 12)}` },
  ]
  for (const { ref, branch, version } of cases) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox, { version })
    const result = await run('install-dev.sh', sandbox, { STUB_BRANCHES: branch ? `main ${ref}` : 'main' }, ['--ref', ref])
    assertOk(result)
    assert.match(await readFile(cliPath(sandbox), 'utf8'), new RegExp(version.replaceAll('.', '\\.')), ref)
  }
})

void test('install-dev.sh: fork commits, tags, and unknown refs stop before building or installing', async (t) => {
  for (const ref of [FORK_SHA, FORK_SHA.slice(0, 9), 'v0.2.0', 'deadbee', 'abc12']) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox, { version: '0.0.0-dev.main' })
    const result = await run('install-dev.sh', sandbox, {}, ['--ref', ref])
    assert.notEqual(result.code, 0, ref)
    if (ref.startsWith(FORK_SHA.slice(0, 9))) assert.match(result.stderr, /on no origin branch; forks are not supported/)
    assert.ok(result.stderr.includes(ref), result.stderr)
    assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /mise/)
    assert.equal(await exists(cliPath(sandbox)), false)
    assert.equal(await exists(join(sandbox.home, '.local/share')), false)
  }
})

void test('install-dev.sh: refs without a dist task and failed builds change nothing', async (t) => {
  const failures: Record<string, string>[] = [{ STUB_NO_DIST: '1' }, { STUB_DIST_FAIL: '1' }]
  for (const env of failures) {
    const sandbox = await createSandbox(t.after.bind(t))
    await createFullRelease(sandbox, { version: '0.0.0-dev.main' })
    const result = await run('install-dev.sh', sandbox, env)
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, 'STUB_NO_DIST' in env ? /predates install-dev/ : /build of main failed; nothing was installed/)
    assert.equal(await exists(cliPath(sandbox)), false)
    assert.equal(await exists(recordPath(sandbox)), false)
  }
})

void test('install-dev.sh: builds the zero-dev image when Docker runs; a failed image still installs', async (t) => {
  const sandbox = await createSandbox(t.after.bind(t))
  await createFullRelease(sandbox, { version: '0.0.0-dev.main' })
  const result = await run('install-dev.sh', sandbox, { STUB_DOCKER: '0' })
  assertOk(result)
  assert.match(await readFile(sandbox.log, 'utf8'), /^mise run dist:image version=0\.0\.0-dev\.main trusted=\S+\/src pwd=\S+\/src$/m)
  assert.match(result.stdout, /built zero-dev:0\.0\.0-dev\.main for zero attach/)
  const uninstall = await run('uninstall.sh', sandbox, { STUB_DOCKER_IMAGES: 'zero-dev:0.0.0-dev.main\nzero-dev:0.0.0-dev.old\n' })
  assertOk(uninstall)
  assert.match(uninstall.stdout, /docker image rm zero-dev:0\.0\.0-dev\.main zero-dev:0\.0\.0-dev\.old/)
})

void test('install-dev.sh: missing git, mise, or jq stops with a hint before changing anything', async (t) => {
  for (const tool of ['git', 'mise', 'jq']) {
    const sandbox = await createSandbox(t.after.bind(t), { without: [tool] })
    const result = await run('install-dev.sh', sandbox, { PATH: await pathWithout(sandbox, [tool]) })
    assert.notEqual(result.code, 0, tool)
    assert.match(result.stderr, new RegExp(`${tool} is required`))
    assert.deepEqual(await readdir(sandbox.home), [])
  }
})

void test('install-dev.sh: a running app or macOS Intel stops before cloning', async (t) => {
  const stops: Record<string, string>[] = [{ STUB_PGREP: '0' }, { STUB_UNAME_S: 'Darwin', STUB_UNAME_M: 'x86_64' }]
  for (const env of stops) {
    const sandbox = await createSandbox(t.after.bind(t))
    const result = await run('install-dev.sh', sandbox, env)
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, 'STUB_PGREP' in env ? /desktop app is running/ : /macOS Intel/)
    assert.doesNotMatch(await readFile(sandbox.log, 'utf8'), /git clone/)
  }
})
