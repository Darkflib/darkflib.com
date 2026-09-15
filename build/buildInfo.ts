import { execFileSync } from 'node:child_process'

export interface BuildInfo {
  /** Short commit SHA, or `unknown` outside a git checkout. */
  sha: string
  /** Whether the working tree had uncommitted changes when the build started. */
  dirty: boolean
  /** ISO 8601 build (or dev server start) time. */
  time: string
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

export function readBuildInfo(): BuildInfo {
  const time = new Date().toISOString()
  // Container builds have no .git; the Containerfile passes these as build args instead.
  const sha = process.env.BUILD_SHA?.trim()
  if (sha) {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error(`BUILD_SHA is not a commit SHA: ${sha}`)
    return { sha: sha.slice(0, 7), dirty: process.env.BUILD_DIRTY === 'true', time }
  }
  try {
    return { sha: git('rev-parse', '--short=7', 'HEAD'), dirty: git('status', '--porcelain') !== '', time }
  } catch {
    return { sha: 'unknown', dirty: false, time }
  }
}
