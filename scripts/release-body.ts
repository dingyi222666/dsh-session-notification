/**
 * The GitHub release body generator, in the ChatLunaLab/chatluna release
 * format: hand-written 新特性 / 修复 & 改进 sections (from the per-version
 * release notes), the mechanical What's Changed list with author
 * attribution, and the Full Changelog compare link.
 * @module dsh-session-notification/release-body
 */

export interface ReleaseCommit {
  /** Full commit hash. */
  hash: string
  /** The one-line conventional subject. */
  subject: string
  /** Commit author's GitHub login, when known. */
  author?: string | undefined
}

/** Hand-written changelog entries for one version. */
export interface ReleaseNotes {
  features: readonly string[]
  fixes: readonly string[]
}

const REPO = 'dsh-external/dsh-session-notification'

/**
 * Build the release body for one version.
 * @param version - the version being released (without the `v` prefix).
 * @param previous - the previous release tag (`vX.Y.Z`), or undefined for the
 * first release.
 * @param commits - the commits in this version, in log order.
 * @param notes - the hand-written 新特性 / 修复 & 改进 entries.
 * @returns the markdown body.
 */
export function buildReleaseBody(
  version: string,
  previous: string | undefined,
  commits: readonly ReleaseCommit[],
  notes: ReleaseNotes,
): string {
  const tag = `v${version}`
  const lines: string[] = [`# dsh-session-notification ${tag}`, '']
  if (notes.features.length > 0) {
    lines.push('## 新特性', ...notes.features, '')
  }
  if (notes.fixes.length > 0) {
    lines.push('## 修复 & 改进', ...notes.fixes, '')
  }
  lines.push("## What's Changed")
  for (const commit of commits) {
    const author = commit.author === undefined ? '' : ` by @${commit.author}`
    lines.push(`* ${commit.subject}${author} in https://github.com/${REPO}/commit/${commit.hash}`)
  }
  if (previous !== undefined) {
    lines.push('', `**Full Changelog**: https://github.com/${REPO}/compare/${previous}...${tag}`)
  }
  return lines.filter(line => line !== '').join('\n')
}
