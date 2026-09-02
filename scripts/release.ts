/**
 * Release the current package.json version: create the `v<version>` git tag
 * and the matching GitHub release (the ChatLuna-style body). Run after
 * bumping and committing the version in package.json:
 *
 *   yarn release
 *
 * Fails loudly when the version is already tagged/released, when gh is not
 * authenticated, or when the GitHub release call fails.
 * @module dsh-session-notification/release
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseBody } from './release-body.ts'
import { RELEASE_NOTES } from './release-notes.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = 'dsh-external/dsh-session-notification'
const MANIFEST = join(ROOT, 'package.json')

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

const { version } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { version?: unknown }
if (typeof version !== 'string' || version === '') {
  console.error('release: no version in package.json')
  process.exit(1)
}
const tag = `v${version}`

/** Whether the tag already exists locally or on the remote. */
function tagExists(): boolean {
  if (git('tag', '-l', tag) !== '') return true
  const remote = spawnSync('git', ['ls-remote', '--tags', 'origin', tag], { cwd: ROOT, encoding: 'utf8' })
  return remote.status === 0 && remote.stdout.trim() !== ''
}

if (tagExists()) {
  console.error(`release: ${tag} already exists — bump the version first`)
  process.exit(1)
}

// The release commit: HEAD (the bump is committed before `yarn release`).
const head = git('rev-parse', 'HEAD')
// The previous release tag, for the changelog range.
let previous = ''
try {
  previous = git('describe', '--tags', '--abbrev=0', 'HEAD~1')
} catch {
  previous = ''
}
const range = previous === '' ? head : `${previous}..${head}`
const commits = git('log', '--format=%H%x09%s', range).split('\n')
  .filter(Boolean)
  .map(line => {
    const [hash, ...subjectParts] = line.split('\t')
    return { hash, subject: subjectParts.join('\t'), author: undefined }
  })

const notes = RELEASE_NOTES[version]
if (notes === undefined) {
  console.error(`release: no hand-written release notes for ${version} — add an entry to scripts/release-notes.ts first`)
  process.exit(1)
}
const body = buildReleaseBody(version, previous === '' ? undefined : previous, commits, notes)

const dir = mkdtempSync(join(tmpdir(), 'dsh-release-'))
const notesFile = join(dir, 'notes.md')
writeFileSync(notesFile, `${body}\n`)

// Create the tag at HEAD and push it first: gh cannot create a release for
// a tag that does not exist yet (422 on --target).
const tagCreate = spawnSync('git', ['tag', tag, head], { cwd: ROOT, encoding: 'utf8' })
if (tagCreate.status !== 0) {
  console.error(`release: tag create failed:\n${tagCreate.stderr}`)
  process.exit(1)
}
const push = spawnSync('git', ['push', 'origin', tag], { cwd: ROOT, encoding: 'utf8' })
if (push.status !== 0) {
  console.error(`release: tag push failed:\n${push.stderr}`)
  process.exit(1)
}
console.log(`release: ${tag} pushed @ ${head.slice(0, 9)}`)

const args = [
  'release', 'create', tag,
  '--repo', REPO,
  '--title', tag,
  '--notes-file', notesFile,
]
console.log(`release: creating ${tag} (${commits.length} commits)`)
const result = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8' })
if (result.status !== 0) {
  console.error(`release: gh failed:\n${result.stderr}`)
  process.exit(1)
}
console.log(result.stdout.trim())
