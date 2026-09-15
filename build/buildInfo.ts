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
  try {
    return { sha: git('rev-parse', '--short=7', 'HEAD'), dirty: git('status', '--porcelain') !== '', time }
  } catch {
    return { sha: 'unknown', dirty: false, time }
  }
}
