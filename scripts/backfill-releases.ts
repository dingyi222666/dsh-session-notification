/**
 * One-time backfill: delete every existing release + tag for the version
 * table below and recreate all of them with the full ChatLuna-style body
 * (hand-written 新特性 / 修复 & 改进 + mechanical What's Changed).
 *
 * Run with:
 *   yarn tsx scripts/backfill-releases.ts
 *
 * Safe to re-run: every version is deleted and recreated from scratch.
 * @module dsh-session-notification/backfill-releases
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseBody } from './release-body.ts'
import { RELEASE_NOTES } from './release-notes.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = 'dingyi222666/dsh-session-notification'

/** Version -> the commit the `v<version>` tag points at. */
const VERSIONS: ReadonlyArray<readonly [version: string, commit: string]> = [
  ['0.1.0', 'bd0fec6a8'],
  ['0.1.1', '4a6a1d20e'],
  ['0.1.2', '91e386dc9'],
  ['0.1.3', '83b52be14'],
  ['0.1.4', '780064341'],
  ['0.1.5', 'f2f093b8c'],
  ['0.1.6', 'b76c81166'],
  ['0.1.7', '35a4e3c71'],
  ['0.1.8', 'd76dd19d6'],
]

/** GitHub logins by git author email. */
const AUTHOR_BY_EMAIL: Record<string, string> = {
  'dingyi222666@foxmail.com': 'dingyi222666',
  'dingyi222666@users.noreply.github.com': 'dingyi222666',
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** Commits of one version: the range from the previous tag's commit to this one. */
function commitsFor(version: string, commit: string, previousCommit: string | undefined): Array<{ hash: string; subject: string; author: string | undefined }> {
  const range = previousCommit === undefined ? commit : `${previousCommit}..${commit}`
  const raw = git('log', '--format=%H%x09%an <%ae>%x09%s', range)
  if (raw === '') return []
  return raw.split('\n').map(line => {
    const [hash, identity, ...subjectParts] = line.split('\t')
    const email = identity.match(/<(.+)>/)?.[1] ?? ''
    return {
      hash,
      subject: subjectParts.join('\t'),
      author: AUTHOR_BY_EMAIL[email] ?? undefined,
    }
  })
}

function run(label: string, cmd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(`  !! ${label} failed:\n${result.stderr || result.stdout}`)
    return { ok: false, out: result.stderr || result.stdout }
  }
  return { ok: true, out: result.stdout }
}

const failed: string[] = []
for (let i = 0; i < VERSIONS.length; i++) {
  const [version, commit] = VERSIONS[i]
  const tag = `v${version}`
  const previousCommit = i === 0 ? undefined : VERSIONS[i - 1]![1]
  const notes = RELEASE_NOTES[version]
  if (notes === undefined) {
    console.error(`backfill: no hand-written release notes for ${version} — aborting`)
    process.exit(1)
  }

  console.log(`\n=== ${tag} @ ${commit} ===`)

  // Delete the existing release (if any) and the tag (local + remote).
  const rel = run('delete release', 'gh', ['release', 'delete', tag, '--repo', REPO, '--yes'])
  if (!rel.ok && !rel.out.includes('not found') && !rel.out.includes('GraphQL')) {
    // gh says "not found" for missing releases; anything else is a hard error.
    failed.push(tag)
    continue
  }
  const tagLocal = run('delete local tag', 'git', ['tag', '-d', tag])
  if (!tagLocal.ok && !tagLocal.out.includes('not found')) {
    failed.push(tag)
    continue
  }
  const tagRemote = run('delete remote tag', 'git', ['push', 'origin', `:refs/tags/${tag}`])
  if (!tagRemote.ok && !tagRemote.out.includes('does not exist') && !tagRemote.out.includes('not found')) {
    failed.push(tag)
    continue
  }

  const commits = commitsFor(version, commit, previousCommit)
  const body = buildReleaseBody(version, previousCommit === undefined ? undefined : `v${VERSIONS[i - 1]![0]}`, commits, notes)

  const dir = mkdtempSync(join(tmpdir(), 'dsh-backfill-'))
  const notesFile = join(dir, 'notes.md')
  writeFileSync(notesFile, `${body}\n`)

  // Create the tag at the release commit and push it first: gh cannot
  // create a release for a tag that does not exist yet (422 on --target).
  const tagCreated = run('create local tag', 'git', ['tag', tag, commit])
  if (!tagCreated.ok) {
    failed.push(tag)
    continue
  }
  const pushed = run('push tag', 'git', ['push', 'origin', tag])
  if (!pushed.ok) {
    failed.push(tag)
    continue
  }
  const created = run('create release', 'gh', [
    'release', 'create', tag,
    '--repo', REPO,
    '--title', tag,
    '--notes-file', notesFile,
  ])
  if (!created.ok) {
    failed.push(tag)
    continue
  }
  console.log(`  ok (${commits.length} commits)`)
}

console.log('\n=== done ===')
if (failed.length > 0) {
  console.error(`failed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('all releases recreated')
